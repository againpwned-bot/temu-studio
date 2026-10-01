import { clamp, el, reducedMotion } from '../utils/dom.js';
import { onFrame } from '../utils/ticker.js';
import { Spring } from '../utils/spring.js';

/**
 * Accessible liquid-glass slider. The thumb is a droplet that stretches with drag
 * velocity and springs back; programmatic changes glide instead of jumping.
 */
export class GlassSlider {
  constructor(root, opts) {
    this.root = root;
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 1;
    this.step = opts.step ?? 0.01;
    this.origin = opts.origin ?? this.min;
    this.defaultValue = opts.defaultValue ?? opts.value ?? this.min;
    this.snaps = opts.snaps ?? [];
    this.format = opts.format ?? ((v) => String(v));
    this.onInput = opts.onInput ?? (() => {});
    this.onChange = opts.onChange ?? (() => {});
    this.value = clamp(opts.value ?? this.min, this.min, this.max);
    this.dragging = false;
    this.disabled = false;
    this.stretch = new Spring(0, { stiffness: 320, damping: 22, precision: 0.001 });
    this.glide = null;
    this._lastX = 0;
    this._lastT = 0;
    this._offFrame = null;

    root.classList.add('gs');
    root.setAttribute('role', 'slider');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-label', opts.label ?? 'Slider');
    root.setAttribute('aria-valuemin', String(this.min));
    root.setAttribute('aria-valuemax', String(this.max));
    this.bubble = el('span', { class: 'gs-bubble' });
    this.thumb = el('span', { class: 'gs-thumb' });
    this.fill = el('span', { class: 'gs-fill' });
    this.originMark = this.origin !== this.min ? el('span', { class: 'gs-origin' }) : null;
    const rail = el('span', { class: 'gs-rail' }, [el('span', { class: 'gs-track' }, [this.fill]), this.originMark, this.thumb, this.bubble]);
    root.replaceChildren(rail);
    this.rail = rail;
    if (this.originMark) this.originMark.style.left = `${this._ratio(this.origin) * 100}%`;

    root.addEventListener('pointerdown', (e) => this._down(e));
    root.addEventListener('pointermove', (e) => this._move(e));
    root.addEventListener('pointerup', (e) => this._up(e));
    root.addEventListener('pointercancel', (e) => this._up(e));
    root.addEventListener('keydown', (e) => this._key(e));
    root.addEventListener('dblclick', () => this._commit(this.defaultValue, true));
    this._render();
  }

  setValue(value, { animate = false, silent = true } = {}) {
    const target = clamp(value, this.min, this.max);
    if (this.dragging) return;
    if (!animate || reducedMotion() || Math.abs(target - this.value) < 1e-6) {
      this._stopGlide();
      this.value = target;
      this._render();
      if (!silent) this.onInput(this.value);
      return;
    }
    this._stopGlide();
    const from = this.value;
    const start = performance.now();
    const duration = 520;
    this.glide = onFrame(() => {
      const t = Math.min(1, (performance.now() - start) / duration);
      const eased = 1 - (1 - t) ** 4;
      this.value = from + (target - from) * eased;
      if (t >= 1) this.value = target;
      this._render();
      if (!silent) this.onInput(this.value);
      if (t >= 1) this._stopGlide();
    });
  }

  setDisabled(disabled) {
    this.disabled = disabled;
    this.root.classList.toggle('is-disabled', disabled);
    this.root.setAttribute('aria-disabled', String(disabled));
    this.root.tabIndex = disabled ? -1 : 0;
  }

  _stopGlide() {
    this.glide?.();
    this.glide = null;
  }

  _ratio(value) {
    return (value - this.min) / (this.max - this.min || 1);
  }

  _quantize(value) {
    let v = Math.round((value - this.min) / this.step) * this.step + this.min;
    const snapRange = (this.max - this.min) * 0.015;
    for (const snap of this.snaps) if (Math.abs(v - snap) <= snapRange) v = snap;
    return clamp(Number(v.toFixed(6)), this.min, this.max);
  }

  _valueFromEvent(e) {
    const rect = this.rail.getBoundingClientRect();
    return this.min + clamp((e.clientX - rect.left) / rect.width, 0, 1) * (this.max - this.min);
  }

  _down(e) {
    if (this.disabled || e.button > 0) return;
    e.preventDefault();
    this._stopGlide();
    this.root.focus({ preventScroll: true });
    this.root.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.root.classList.add('is-dragging');
    this._lastX = e.clientX;
    this._lastT = performance.now();
    this._set(this._quantize(this._valueFromEvent(e)));
  }

  _move(e) {
    if (!this.dragging) return;
    const now = performance.now();
    const dt = Math.max(1, now - this._lastT);
    const velocity = (e.clientX - this._lastX) / dt;
    this._lastX = e.clientX;
    this._lastT = now;
    this.stretch.set(clamp(velocity * 0.12, -0.45, 0.45));
    this._runStretch();
    this._set(this._quantize(this._valueFromEvent(e)));
  }

  _up(e) {
    if (!this.dragging) return;
    this.dragging = false;
    this.root.classList.remove('is-dragging');
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    this.stretch.set(0);
    this._runStretch();
    this.onChange(this.value);
  }

  _key(e) {
    if (this.disabled) return;
    const big = (this.max - this.min) / 10;
    const map = {
      ArrowRight: this.step,
      ArrowUp: this.step,
      ArrowLeft: -this.step,
      ArrowDown: -this.step,
      PageUp: big,
      PageDown: -big,
    };
    let next = null;
    if (e.key in map) next = this.value + map[e.key] * (e.shiftKey ? 10 : 1);
    else if (e.key === 'Home') next = this.min;
    else if (e.key === 'End') next = this.max;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    this._commit(this._quantize(next), false);
  }

  _commit(value, animate) {
    if (this.disabled) return;
    if (animate) {
      this._stopGlide();
      const from = this.value;
      const target = clamp(value, this.min, this.max);
      const start = performance.now();
      this.glide = onFrame(() => {
        const t = Math.min(1, (performance.now() - start) / 420);
        this.value = from + (target - from) * (1 - (1 - t) ** 4);
        if (t >= 1) this.value = target;
        this._render();
        this.onInput(this.value);
        if (t >= 1) {
          this._stopGlide();
          this.onChange(this.value);
        }
      });
      return;
    }
    this._set(value);
    this.onChange(this.value);
  }

  _set(value) {
    if (value === this.value) return;
    this.value = value;
    this._render();
    this.onInput(value);
  }

  _runStretch() {
    if (this._offFrame) return;
    this._offFrame = onFrame((dt) => {
      const settled = this.stretch.step(dt);
      const s = this.stretch.value;
      const a = Math.abs(s);
      this.thumb.style.transform = `skewX(${-s * 18}deg) scale(${1 + a * 0.55}, ${1 - a * 0.3})`;
      if (settled && !this.dragging) {
        this.thumb.style.transform = '';
        this._offFrame();
        this._offFrame = null;
      }
    });
  }

  _render() {
    const p = this._ratio(this.value);
    const o = this._ratio(this.origin);
    this.root.style.setProperty('--p', p.toFixed(5));
    this.fill.style.left = `${Math.min(p, o) * 100}%`;
    this.fill.style.width = `${Math.abs(p - o) * 100}%`;
    const text = this.format(this.value);
    this.bubble.textContent = text;
    this.root.setAttribute('aria-valuenow', String(Number(this.value.toFixed(4))));
    this.root.setAttribute('aria-valuetext', text);
  }
}
