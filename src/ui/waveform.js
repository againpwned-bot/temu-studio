import { Emitter } from '../utils/emitter.js';
import { clamp, reducedMotion } from '../utils/dom.js';
import { formatTime } from '../utils/format.js';
import { hexToRgb } from '../utils/color.js';
import { onFrame } from '../utils/ticker.js';

const BAR = 3;
const GAP = 2;
const MIN_REGION = 0.1;
const SCRUB_INTERVAL = 90;

const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/**
 * Canvas waveform with click/drag seeking and draggable cut handles.
 * The played/unplayed bar layers are pre-rendered offscreen; each frame only composites them.
 *
 * Events: 'seek' (t), 'scrub' (t), 'regioninput' ({start,end}), 'regionchange' ({start,end})
 */
export class Waveform extends Emitter {
  constructor(root) {
    super();
    this.root = root;
    this.canvas = root.querySelector('.wave-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.playhead = root.querySelector('.wave-playhead');
    this.hover = root.querySelector('.wave-hover');
    this.hoverTime = root.querySelector('.wave-hover-time');
    this.regionEl = root.querySelector('.wave-region');
    this.handles = {
      start: root.querySelector('[data-handle="start"]'),
      end: root.querySelector('[data-handle="end"]'),
    };
    this.base = document.createElement('canvas');
    this.played = document.createElement('canvas');

    this.peaks = null;
    this.bars = null;
    this.duration = 0;
    this.time = 0;
    this.previewTime = null;
    this.region = null;
    this.cutMode = false;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.colors = { a: hexToRgb('#7cc8ff'), b: hexToRgb('#b59bff') };
    this.grow = 1;
    this.drag = null;
    this.lastScrub = 0;
    this.lastSeek = 0;
    this.ariaSecond = -1;
    this.offAnim = null;
    this.idlePhase = 0;

    new ResizeObserver(() => this._resize()).observe(root);
    root.addEventListener('pointerdown', (e) => this._down(e));
    root.addEventListener('pointermove', (e) => this._move(e));
    root.addEventListener('pointerup', (e) => this._up(e));
    root.addEventListener('pointercancel', (e) => this._up(e));
    root.addEventListener('pointerleave', () => this.root.classList.remove('is-hovering'));
    root.addEventListener('keydown', (e) => this._key(e));
    for (const [which, handle] of Object.entries(this.handles)) {
      handle.addEventListener('keydown', (e) => this._handleKey(e, which));
    }
    this._startIdle();
  }

  setColors(accent, accent2) {
    this.colors = { a: hexToRgb(accent), b: hexToRgb(accent2) };
    if (this.peaks) {
      this._renderLayers();
      this._draw();
    }
  }

  setLoading(loading) {
    this.root.classList.toggle('is-loading', loading);
  }

  setData(peaks, duration, { animate = true } = {}) {
    this.peaks = peaks;
    this.duration = duration;
    this.time = 0;
    this.previewTime = null;
    this.root.setAttribute('aria-valuemax', duration.toFixed(1));
    this.root.classList.add('has-data');
    this._stopAnim();
    this._computeBars();
    if (animate && !reducedMotion()) {
      this.grow = 0;
      const start = performance.now();
      this.offAnim = onFrame(() => {
        this.grow = Math.min(1, (performance.now() - start) / 1100);
        this._renderLayers();
        this._draw();
        if (this.grow >= 1) this._stopAnim();
      });
    } else {
      this.grow = 1;
      this._renderLayers();
      this._draw();
    }
  }

  clear() {
    this.peaks = null;
    this.bars = null;
    this.duration = 0;
    this.region = null;
    this.cutMode = false;
    this.root.classList.remove('has-data', 'is-cutting');
    this.root.setAttribute('aria-valuemax', '0');
    this._stopAnim();
    this._startIdle();
  }

  setTime(time) {
    if (!this.peaks || (time === this.time && this.previewTime === null)) return;
    this.time = time;
    if (this.previewTime === null) this._draw();
    const second = Math.floor(time);
    if (second !== this.ariaSecond) {
      this.ariaSecond = second;
      this.root.setAttribute('aria-valuenow', String(second));
      this.root.setAttribute('aria-valuetext', `${formatTime(time)} of ${formatTime(this.duration)}`);
    }
  }

  setCutMode(on, region = null) {
    this.cutMode = on;
    this.region = on && region ? { ...region } : null;
    for (const handle of Object.values(this.handles)) handle.tabIndex = on ? 0 : -1;
    this._renderRegion();
  }

  setRegion(region) {
    this.region = region ? { ...region } : null;
    this._renderRegion();
  }

  _stopAnim() {
    this.offAnim?.();
    this.offAnim = null;
  }

  _startIdle() {
    this._stopAnim();
    this.offAnim = onFrame((dt) => {
      if (!reducedMotion()) this.idlePhase += dt;
      this._drawIdle();
    });
  }

  _resize() {
    const rect = this.root.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    if (this.peaks) {
      this._computeBars();
      this._renderLayers();
      this._draw();
    } else this._drawIdle();
    this._renderRegion();
  }

  _computeBars() {
    if (!this.peaks || !this.width) return;
    const count = Math.max(1, Math.floor((this.width + GAP) / (BAR + GAP)));
    const bars = new Float32Array(count);
    const n = this.peaks.length;
    for (let i = 0; i < count; i++) {
      const from = Math.floor((i * n) / count);
      const to = Math.max(from + 1, Math.floor(((i + 1) * n) / count));
      let max = 0;
      let sum = 0;
      for (let j = from; j < to; j++) {
        const v = this.peaks[j];
        if (v > max) max = v;
        sum += v;
      }
      bars[i] = max * 0.6 + (sum / (to - from)) * 0.4;
    }
    this.bars = bars;
  }

  _barFactor(i, count) {
    if (this.grow >= 1) return 1;
    const delay = (i / count) * 0.45;
    const local = clamp((this.grow - delay) / 0.55, 0, 1);
    return local <= 0 ? 0 : easeOutBack(local);
  }

  _renderLayers() {
    if (!this.bars || !this.width) return;
    const { width: w, height: h, dpr } = this;
    const mid = Math.round(h * 0.64);
    const upMax = mid - 6;
    const downMax = h - mid - 6;
    const count = this.bars.length;
    const radius = BAR / 2;

    const paint = (canvas, fill, reflectionAlpha) => {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const top = new Path2D();
      const bottom = new Path2D();
      const round = typeof top.roundRect === 'function';
      for (let i = 0; i < count; i++) {
        const v = this.bars[i] * this._barFactor(i, count);
        const x = i * (BAR + GAP);
        const hu = Math.max(2, v * upMax);
        const hd = Math.max(1, v * downMax * 0.85);
        if (round) {
          top.roundRect(x, mid - hu - 1, BAR, hu, radius);
          bottom.roundRect(x, mid + 2, BAR, hd, radius);
        } else {
          top.rect(x, mid - hu - 1, BAR, hu);
          bottom.rect(x, mid + 2, BAR, hd);
        }
      }
      g.fillStyle = fill(g);
      g.fill(top);
      g.globalAlpha = reflectionAlpha;
      g.fill(bottom);
      g.globalAlpha = 1;
    };

    paint(this.base, () => 'rgba(255, 255, 255, 0.34)', 0.42);
    const { a, b } = this.colors;
    paint(
      this.played,
      (g) => {
        const grad = g.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, `rgb(${a.r}, ${a.g}, ${a.b})`);
        grad.addColorStop(1, `rgb(${b.r}, ${b.g}, ${b.b})`);
        return grad;
      },
      0.45,
    );
  }

  _xFromTime(t) {
    return this.duration ? (clamp(t, 0, this.duration) / this.duration) * this.width : 0;
  }

  _timeFromEvent(e) {
    const rect = this.root.getBoundingClientRect();
    return clamp((e.clientX - rect.left) / rect.width, 0, 1) * this.duration;
  }

  _draw() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.peaks || !this.base.width) return;
    c.drawImage(this.base, 0, 0);
    const t = this.previewTime ?? this.time;
    const x = this._xFromTime(t);
    const sx = Math.round(x * this.dpr);
    if (sx > 0) c.drawImage(this.played, 0, 0, sx, this.played.height, 0, 0, sx, this.played.height);
    this.playhead.style.transform = `translateX(${x.toFixed(2)}px)`;
  }

  _drawIdle() {
    const c = this.ctx;
    const { width: w, height: h, dpr } = this;
    if (!w) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const count = Math.floor((w + GAP) / (BAR + GAP));
    const mid = Math.round(h * 0.64);
    const p = this.idlePhase;
    const top = new Path2D();
    const bottom = new Path2D();
    for (let i = 0; i < count; i++) {
      const v = 0.07 + 0.05 * Math.sin(i * 0.22 + p * 2.1) + 0.04 * Math.sin(i * 0.071 - p * 1.3) + 0.025 * Math.sin(i * 0.53 + p * 3.2);
      const hu = Math.max(2, v * (mid - 6));
      top.rect(i * (BAR + GAP), mid - hu - 1, BAR, hu);
      bottom.rect(i * (BAR + GAP), mid + 2, BAR, Math.max(1, hu * 0.5));
    }
    c.fillStyle = 'rgba(255, 255, 255, 0.22)';
    c.fill(top);
    c.globalAlpha = 0.4;
    c.fill(bottom);
    c.globalAlpha = 1;
  }

  _renderRegion() {
    const show = Boolean(this.cutMode && this.region && this.duration);
    this.root.classList.toggle('is-cutting', show);
    if (!show) return;
    const { start, end } = this.region;
    this.regionEl.style.setProperty('--l', `${(start / this.duration) * 100}%`);
    this.regionEl.style.setProperty('--r', `${(end / this.duration) * 100}%`);
    this.handles.start.firstElementChild.textContent = formatTime(start, true);
    this.handles.end.firstElementChild.textContent = formatTime(end, true);
    this.handles.start.setAttribute('aria-valuetext', formatTime(start, true));
    this.handles.end.setAttribute('aria-valuetext', formatTime(end, true));
  }

  _down(e) {
    if (!this.peaks || e.button > 0) return;
    const handle = e.target.closest('.wave-handle');
    e.preventDefault();
    this.root.setPointerCapture(e.pointerId);
    if (handle && this.cutMode) {
      this.drag = { type: handle.dataset.handle };
      this.root.classList.add('is-dragging-handle');
      handle.focus({ preventScroll: true });
      return;
    }
    this.root.focus({ preventScroll: true });
    this.drag = { type: 'seek' };
    this.root.classList.add('is-scrubbing');
    this.previewTime = this._timeFromEvent(e);
    this.lastScrub = performance.now();
    this.lastSeek = this.previewTime;
    this._draw();
    this.emit('seek', this.previewTime);
  }

  _move(e) {
    if (!this.peaks) return;
    const t = this._timeFromEvent(e);
    if (!this.drag) {
      this.root.classList.add('is-hovering');
      this.hover.style.transform = `translateX(${this._xFromTime(t).toFixed(1)}px)`;
      this.hoverTime.textContent = formatTime(t);
      return;
    }
    if (this.drag.type === 'seek') {
      this.previewTime = t;
      this.hover.style.transform = `translateX(${this._xFromTime(t).toFixed(1)}px)`;
      this.hoverTime.textContent = formatTime(t);
      this._draw();
      const now = performance.now();
      if (now - this.lastScrub > SCRUB_INTERVAL) {
        this.lastScrub = now;
        this.lastSeek = t;
        this.emit('scrub', t);
      }
      return;
    }
    const region = this.region;
    if (this.drag.type === 'start') region.start = clamp(t, 0, region.end - MIN_REGION);
    else region.end = clamp(t, region.start + MIN_REGION, this.duration);
    this._renderRegion();
    this.emit('regioninput', { ...region });
  }

  _up(e) {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    this.root.classList.remove('is-scrubbing', 'is-dragging-handle');
    if (drag.type === 'seek') {
      const t = this.previewTime ?? this.time;
      this.previewTime = null;
      this.time = t;
      this._draw();
      if (Math.abs(t - this.lastSeek) > 0.01) this.emit('seek', t);
    } else {
      this.emit('regionchange', { ...this.region });
    }
  }

  _key(e) {
    if (!this.peaks || e.target !== this.root) return;
    let t = null;
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = this.time + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = this.time - step;
    else if (e.key === 'Home') t = 0;
    else if (e.key === 'End') t = this.duration;
    if (t === null) return;
    e.preventDefault();
    e.stopPropagation();
    this.emit('seek', clamp(t, 0, this.duration));
  }

  _handleKey(e, which) {
    if (!this.cutMode || !this.region) return;
    const step = e.shiftKey ? 1 : 0.1;
    let delta = 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    const region = this.region;
    if (which === 'start') region.start = clamp(region.start + delta, 0, region.end - MIN_REGION);
    else region.end = clamp(region.end + delta, region.start + MIN_REGION, this.duration);
    this._renderRegion();
    this.emit('regionchange', { ...region });
  }
}
