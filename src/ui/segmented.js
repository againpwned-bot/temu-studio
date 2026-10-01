import { $$ } from '../utils/dom.js';
import { onFrame } from '../utils/ticker.js';
import { Spring } from '../utils/spring.js';

/**
 * Segmented control with a liquid indicator: the leading edge runs on a stiffer spring
 * than the trailing edge, so the blob stretches toward its target and then settles.
 */
export class Segmented {
  constructor(root, { value, onChange = () => {}, role = 'tab' } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.role = role;
    this.indicator = root.querySelector('.seg-indicator');
    this.buttons = $$('[data-value]', root);
    this.left = new Spring(0, { stiffness: 300, damping: 28, precision: 0.05 });
    this.right = new Spring(0, { stiffness: 300, damping: 28, precision: 0.05 });
    this.value = value ?? this.buttons.find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.value ?? this.buttons[0]?.dataset.value;
    this.off = null;
    this.placed = false;

    for (const button of this.buttons) {
      button.addEventListener('click', () => this.select(button.dataset.value));
      button.addEventListener('keydown', (e) => this._key(e));
    }
    new ResizeObserver(() => this._place(false)).observe(root);
    this._mark();
    requestAnimationFrame(() => this._place(false));
  }

  select(value, { emit = true, animate = true } = {}) {
    if (!this.buttons.some((b) => b.dataset.value === value)) return;
    const changed = value !== this.value;
    this.value = value;
    this._mark();
    this._place(animate);
    if (changed && emit) this.onChange(value);
  }

  setDisabled(value, disabled) {
    const button = this.buttons.find((b) => b.dataset.value === value);
    if (button) button.disabled = disabled;
  }

  _mark() {
    for (const button of this.buttons) {
      const active = button.dataset.value === this.value;
      if (this.role === 'tab') {
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      } else button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    }
  }

  _key(e) {
    if (this.role !== 'tab' || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const enabled = this.buttons.filter((b) => !b.disabled);
    const i = enabled.findIndex((b) => b.dataset.value === this.value);
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    next.focus();
    this.select(next.dataset.value);
  }

  _place(animate) {
    const button = this.buttons.find((b) => b.dataset.value === this.value);
    if (!button || !this.indicator) return;
    const l = button.offsetLeft;
    const r = l + button.offsetWidth;
    if (!animate || !this.placed) {
      this.placed = l > 0 || r > 0;
      this.left.snap(l);
      this.right.snap(r);
      this._render();
      return;
    }
    const movingRight = l > this.left.value;
    this.left.stiffness = movingRight ? 170 : 420;
    this.right.stiffness = movingRight ? 420 : 170;
    this.left.set(l);
    this.right.set(r);
    if (this.off) return;
    this.off = onFrame((dt) => {
      const a = this.left.step(dt);
      const b = this.right.step(dt);
      this._render();
      if (a && b) {
        this.off();
        this.off = null;
      }
    });
  }

  _render() {
    const l = this.left.value;
    const w = Math.max(8, this.right.value - l);
    this.indicator.style.transform = `translateX(${l}px)`;
    this.indicator.style.width = `${w}px`;
  }
}
