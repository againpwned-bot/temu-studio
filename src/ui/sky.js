import { clamp, lerp, reducedMotion } from '../utils/dom.js';
import { hexToRgb, mixRgb, scaleRgb } from '../utils/color.js';
import { onFrame } from '../utils/ticker.js';
import { Spring } from '../utils/spring.js';
import { mulberry32 } from '../utils/noise.js';

const CANVAS_TOP = 0.5;
const WHITE = { r: 255, g: 255, b: 255 };

/** Three parallax cloud banks; together they fill the lower quarter of the page. Back → front. */
const LAYERS = [
  { width: 1024, height: 200, top: 0.6, bottom: 0.87, speed: 5, seed: 11, feature: 70, alpha: 0.72, haze: 0.45, depth: 6 },
  { width: 1280, height: 230, top: 0.66, bottom: 0.96, speed: 10, seed: 23, feature: 85, alpha: 0.9, haze: 0.2, depth: 12 },
  { width: 1536, height: 270, top: 0.72, bottom: 1.05, speed: 18, seed: 37, feature: 100, alpha: 1, haze: 0, depth: 22 },
];

/**
 * Generated sky: CSS gradient (smoothly animatable via registered custom properties) plus
 * procedurally generated cloud banks rendered to a canvas and recoloured in place.
 */
export class Sky {
  constructor(root) {
    this.root = root;
    this.canvas = root.querySelector('.sky-clouds');
    this.ctx = this.canvas.getContext('2d');
    this.starsCanvas = root.querySelector('.sky-stars');
    this.layers = LAYERS.map((def) => ({ ...def, density: null, shade: null, tex: null, texCtx: null, image: null, offset: Math.random() * 2000, fade: 0 }));
    this.alphaLUT = new Uint8ClampedArray(256);
    this.cur = { cloud: { ...WHITE }, horizon: hexToRgb('#a9d4ff') };
    this.target = { cloud: { ...WHITE }, horizon: hexToRgb('#a9d4ff') };
    this.densityLevel = 0.55;
    this.speed = 1;
    this.motion = true;
    this.stars = false;
    this.mouse = new Spring(0, { stiffness: 18, damping: 9, precision: 0.0005 });
    this.dirtyColor = true;
    this.vw = 0;
    this.vh = 0;
    this.dpr = 1;
    this.off = null;

    this._grain();
    this._buildAlpha();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'mouse') this.mouse.set((e.clientX / window.innerWidth - 0.5) * 2);
      },
      { passive: true },
    );

    this.worker = new Worker(new URL('../workers/clouds.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this._receive(data);
    this.layers.forEach((layer, id) =>
      this.worker.postMessage({ id, width: layer.width, height: layer.height, seed: layer.seed, feature: layer.feature }),
    );
    this._start();
  }

  configure(v) {
    this.target.cloud = hexToRgb(v.cloudColor);
    this.target.horizon = hexToRgb(v.skyHorizon);
    if (v.cloudDensity !== this.densityLevel) {
      this.densityLevel = v.cloudDensity;
      this._buildAlpha();
      this.dirtyColor = true;
    }
    this.speed = v.cloudSpeed;
    this.motion = !v.reduceMotion;
    if (v.stars !== this.stars) {
      this.stars = v.stars;
      this._drawStars();
    }
    this.starsCanvas.classList.toggle('is-on', v.stars);
    this._start();
  }

  _start() {
    if (this.off) return;
    this.off = onFrame((dt) => this._frame(dt));
  }

  _receive({ id, density, shade }) {
    const layer = this.layers[id];
    layer.density = density;
    layer.shade = shade;
    layer.tex = document.createElement('canvas');
    layer.tex.width = layer.width;
    layer.tex.height = layer.height;
    layer.texCtx = layer.tex.getContext('2d');
    layer.image = layer.texCtx.createImageData(layer.width, layer.height);
    this._colorize(layer);
    this.canvas.classList.add('is-ready');
    if (this.layers.every((l) => l.density)) this.worker.terminate();
    this._start();
  }

  _buildAlpha() {
    const threshold = lerp(0.6, -0.4, this.densityLevel);
    const soft = 0.14;
    for (let b = 0; b < 256; b++) {
      const raw = (b / 255) * 3 - 1.2;
      const t = clamp((raw - (threshold - soft)) / (2 * soft), 0, 1);
      this.alphaLUT[b] = t * t * (3 - 2 * t) * 255;
    }
  }

  _palette(layer) {
    const { cloud, horizon } = this.cur;
    const lit = mixRgb(cloud, WHITE, 0.28);
    const shadow = mixRgb(scaleRgb(cloud, 0.62), horizon, 0.3);
    const pal = new Uint8ClampedArray(256 * 3);
    for (let s = 0; s < 256; s++) {
      let c = mixRgb(shadow, lit, (s / 255) ** 0.9);
      if (layer.haze) c = mixRgb(c, horizon, layer.haze);
      pal[s * 3] = c.r;
      pal[s * 3 + 1] = c.g;
      pal[s * 3 + 2] = c.b;
    }
    return pal;
  }

  _colorize(layer) {
    if (!layer.density) return;
    const pal = this._palette(layer);
    const alpha = this.alphaLUT;
    const d = layer.image.data;
    const { density, shade } = layer;
    const layerAlpha = layer.alpha;
    for (let i = 0, j = 0; i < density.length; i++, j += 4) {
      const a = alpha[density[i]];
      if (a === 0) {
        d[j + 3] = 0;
        continue;
      }
      const s = shade[i] * 3;
      d[j] = pal[s];
      d[j + 1] = pal[s + 1];
      d[j + 2] = pal[s + 2];
      d[j + 3] = a * layerAlpha;
    }
    layer.texCtx.putImageData(layer.image, 0, 0);
  }

  _frame(dt) {
    const k = 1 - Math.exp(-dt * 5);
    let colorMoving = false;
    for (const key of ['cloud', 'horizon']) {
      const c = this.cur[key];
      const t = this.target[key];
      const dist = Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b);
      if (dist > 1.5) {
        this.cur[key] = mixRgb(c, t, k);
        colorMoving = true;
      } else if (dist > 0) {
        this.cur[key] = { ...t };
        colorMoving = true;
      }
    }
    if (colorMoving || this.dirtyColor) {
      for (const layer of this.layers) this._colorize(layer);
      this.dirtyColor = false;
    }

    const moving = this.motion && !reducedMotion();
    const mouseSettled = this.mouse.step(dt);
    let fading = false;
    for (const layer of this.layers) {
      if (layer.tex && layer.fade < 1) {
        layer.fade = Math.min(1, layer.fade + dt / 1.4);
        fading = true;
      }
    }
    this._draw(moving ? dt : 0);

    if (!moving && !colorMoving && !fading && mouseSettled && this.layers.every((l) => l.tex)) {
      this.off();
      this.off = null;
    }
  }

  _draw(dt) {
    const { ctx, canvas } = this;
    const scale = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of this.layers) {
      if (!layer.tex) continue;
      const y = (layer.top - CANVAS_TOP) * this.vh * scale;
      const h = (layer.bottom - layer.top) * this.vh * scale;
      const tileW = h * (layer.width / layer.height);
      layer.offset = (layer.offset + dt * layer.speed * this.speed * scale) % tileW;
      const shift = layer.offset + this.mouse.value * layer.depth * scale;
      let x = -(((shift % tileW) + tileW) % tileW);
      ctx.globalAlpha = layer.fade * layer.fade * (3 - 2 * layer.fade);
      for (; x < canvas.width; x += tileW) ctx.drawImage(layer.tex, x, y, tileW + 1, h);
    }
    ctx.globalAlpha = 1;
  }

  _resize() {
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * (1 - CANVAS_TOP) * this.dpr);
    this._drawStars();
    this._draw(0);
    this._start();
  }

  _drawStars() {
    const c = this.starsCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(window.innerWidth * dpr);
    c.height = Math.round(window.innerHeight * dpr);
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (!this.stars) return;
    const rand = mulberry32(7);
    const count = Math.round((window.innerWidth * window.innerHeight) / 5200);
    for (let i = 0; i < count; i++) {
      const x = rand() * c.width;
      const y = rand() ** 1.4 * c.height * 0.72;
      const r = (0.35 + rand() ** 3 * 1.3) * dpr;
      g.globalAlpha = 0.25 + rand() * 0.75;
      g.fillStyle = rand() < 0.15 ? '#cfe0ff' : '#ffffff';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /** Tiny noise tile laid over the gradient so it never bands on 8-bit displays. */
  _grain() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    const rand = mulberry32(3);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(rand() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.root.style.setProperty('--grain', `url(${c.toDataURL()})`);
  }
}
