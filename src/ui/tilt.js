import { onFrame } from '../utils/ticker.js';
import { Spring } from '../utils/spring.js';

/**
 * Springy 3D tilt for the card wrapper plus a pointer-tracked specular light layer.
 * The tilt goes on the wrapper (not the glass) so backdrop blur keeps sampling the sky.
 */
export class Tilt {
  constructor(wrap, glass, light) {
    this.wrap = wrap;
    this.glass = glass;
    this.light = light;
    this.rx = new Spring(0, { stiffness: 90, damping: 14, precision: 0.001 });
    this.ry = new Spring(0, { stiffness: 90, damping: 14, precision: 0.001 });
    this.enabled = false;
    this.off = null;
    this.rect = null;
    this.capable = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const refresh = () => {
      this.rect = null;
    };
    new ResizeObserver(refresh).observe(glass);
    window.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('pointermove', (e) => this._move(e), { passive: true });
    document.documentElement.addEventListener('pointerleave', () => this._center());
    window.addEventListener('blur', () => this._center());
  }

  setEnabled(on) {
    this.enabled = on && this.capable;
    if (!this.enabled) this._center();
  }

  _move(e) {
    if (e.pointerType !== 'mouse') return;
    this.rect ??= this.glass.getBoundingClientRect();
    const r = this.rect;
    this.light.style.setProperty('--lx', `${(e.clientX - r.left).toFixed(0)}px`);
    this.light.style.setProperty('--ly', `${(e.clientY - r.top).toFixed(0)}px`);
    if (!this.enabled) return;
    const nx = (e.clientX - (r.left + r.width / 2)) / Math.max(1, window.innerWidth / 2);
    const ny = (e.clientY - (r.top + r.height / 2)) / Math.max(1, window.innerHeight / 2);
    this.ry.set(Math.max(-1, Math.min(1, nx)) * 3.2);
    this.rx.set(Math.max(-1, Math.min(1, ny)) * -2.6);
    this._run();
  }

  _center() {
    this.rx.set(0);
    this.ry.set(0);
    this._run();
  }

  _run() {
    if (this.off) return;
    this.off = onFrame((dt) => {
      const a = this.rx.step(dt);
      const b = this.ry.step(dt);
      const x = this.rx.value;
      const y = this.ry.value;
      this.wrap.style.transform = Math.abs(x) + Math.abs(y) < 0.002 ? '' : `perspective(1600px) rotateX(${x.toFixed(3)}deg) rotateY(${y.toFixed(3)}deg)`;
      if (a && b) {
        this.off();
        this.off = null;
      }
    });
  }
}
