import { hexToRgb } from '../utils/color.js';
import { onFrame } from '../utils/ticker.js';

/** guns.lol style cursor trail: little four-point stars that drift and fade. */
export class Sparkles {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.enabled = false;
    this.colors = [hexToRgb('#7cc8ff'), hexToRgb('#b59bff')];
    this.last = 0;
    this.off = null;
    this.dpr = 1;
    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('pointermove', (e) => this._spawn(e), { passive: true });
  }

  setEnabled(on) {
    this.enabled = on && window.matchMedia('(pointer: fine)').matches;
    if (!this.enabled) {
      this.particles.length = 0;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  setColors(a, b) {
    this.colors = [hexToRgb(a), hexToRgb(b)];
  }

  _resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  _spawn(e) {
    if (!this.enabled || e.pointerType !== 'mouse') return;
    const now = performance.now();
    if (now - this.last < 32) return;
    this.last = now;
    this.particles.push({
      x: e.clientX,
      y: e.clientY,
      vx: (Math.random() - 0.5) * 36,
      vy: (Math.random() - 0.3) * 30,
      life: 0,
      max: 0.55 + Math.random() * 0.5,
      size: 3 + Math.random() * 4,
      spin: (Math.random() - 0.5) * 4,
      rot: Math.random() * Math.PI,
      color: this.colors[Math.random() < 0.5 ? 0 : 1],
    });
    if (this.particles.length > 48) this.particles.shift();
    if (!this.off) this.off = onFrame((dt) => this._frame(dt));
  }

  _frame(dt) {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = 'lighter';
    this.particles = this.particles.filter((p) => (p.life += dt) < p.max);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 26 * dt;
      p.rot += p.spin * dt;
      const t = p.life / p.max;
      const s = p.size * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.globalAlpha = 1 - t;
      g.fillStyle = `rgb(${p.color.r}, ${p.color.g}, ${p.color.b})`;
      g.beginPath();
      g.moveTo(0, -s);
      g.quadraticCurveTo(0, 0, s, 0);
      g.quadraticCurveTo(0, 0, 0, s);
      g.quadraticCurveTo(0, 0, -s, 0);
      g.quadraticCurveTo(0, 0, 0, -s);
      g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    if (!this.particles.length) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.off();
      this.off = null;
    }
  }
}
