const SVG_NS = 'http://www.w3.org/2000/svg';
let counter = 0;

/** SVG filters inside backdrop-filter only render in Chromium (Chrome, Edge, Brave, Opera, Arc). */
export function supportsLiquidGlass() {
  const brands = navigator.userAgentData?.brands?.map((b) => b.brand) ?? [];
  const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b)) || /Chrome\/\d+/.test(navigator.userAgent);
  const firefox = /Firefox\//.test(navigator.userAgent);
  return chromium && !firefox && CSS.supports('backdrop-filter', 'url(#x)');
}

/**
 * Builds a displacement map for a rounded rectangle: pixels inside the bezel are pushed
 * toward the centre, strongest at the rim, which makes the backdrop bend like thick glass.
 */
function displacementMap(width, height, radius, bezel) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  const image = g.createImageData(width, height);
  const d = image.data;
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.min(radius, hw, hh);

  for (let y = 0; y < height; y++) {
    const py = y + 0.5 - hh;
    const qy = Math.abs(py) - (hh - r);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const px = x + 0.5 - hw;
      const qx = Math.abs(px) - (hw - r);
      let dist;
      let nx = 0;
      let ny = 0;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        dist = r - len;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        dist = r - qx;
        nx = Math.sign(px);
      } else {
        dist = r - qy;
        ny = Math.sign(py);
      }
      let m = 0;
      if (dist >= 0 && dist < bezel) {
        const t = 1 - dist / bezel;
        m = t * t;
      }
      d[i] = 128 - nx * m * 127;
      d[i + 1] = 128 - ny * m * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

export class LiquidGlass {
  constructor(svgRoot) {
    this.svg = svgRoot;
    this.supported = supportsLiquidGlass();
    this.enabled = false;
    this.blur = 22;
    this.items = new Map();
    this.timers = new Map();
    this.observer = new ResizeObserver((entries) => {
      for (const entry of entries) this._schedule(entry.target);
    });
  }

  attach(element, { radius = 28, bezel = 26, scale = 70, saturate = 1.7, followRadius = true } = {}) {
    if (!this.supported || this.items.has(element)) return;
    const id = `liquid-glass-${++counter}`;
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');

    const blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
    blur.setAttribute('in', 'SourceGraphic');
    blur.setAttribute('result', 'soft');
    // Chromium ignores edgeMode for backdrop input, so the blur fades to transparent near the
    // edges and raw backdrop leaks through. Forcing alpha back to 1 keeps the rim fully frosted.
    const opaque = document.createElementNS(SVG_NS, 'feColorMatrix');
    opaque.setAttribute('in', 'soft');
    opaque.setAttribute('type', 'matrix');
    opaque.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1');
    opaque.setAttribute('result', 'blurred');
    const image = document.createElementNS(SVG_NS, 'feImage');
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('result', 'map');
    const displace = document.createElementNS(SVG_NS, 'feDisplacementMap');
    displace.setAttribute('in', 'blurred');
    displace.setAttribute('in2', 'map');
    displace.setAttribute('xChannelSelector', 'R');
    displace.setAttribute('yChannelSelector', 'G');
    displace.setAttribute('result', 'bent');
    const color = document.createElementNS(SVG_NS, 'feColorMatrix');
    color.setAttribute('in', 'bent');
    color.setAttribute('type', 'saturate');
    color.setAttribute('values', String(saturate));

    filter.append(blur, opaque, image, displace, color);
    this.svg.append(filter);
    this.items.set(element, { id, filter, blur, image, displace, radius, bezel, scale, followRadius, width: 0, height: 0 });
    this.observer.observe(element);
    this._update(element);
  }

  setEnabled(on) {
    this.enabled = on && this.supported;
    for (const element of this.items.keys()) this._apply(element);
  }

  setBlur(px) {
    this.blur = px;
    for (const item of this.items.values()) item.blur.setAttribute('stdDeviation', String(Math.max(0.01, px * 0.6)));
  }

  setRadius(radius) {
    for (const [element, item] of this.items) {
      if (!item.followRadius) continue;
      item.radius = radius;
      item.width = 0;
      this._update(element);
    }
  }

  _schedule(element) {
    clearTimeout(this.timers.get(element));
    this.timers.set(
      element,
      setTimeout(() => this._update(element), 120),
    );
  }

  _update(element) {
    const item = this.items.get(element);
    if (!item) return;
    const width = Math.round(element.offsetWidth);
    const height = Math.round(element.offsetHeight);
    if (!width || !height || (width === item.width && height === item.height)) return;
    item.width = width;
    item.height = height;
    for (const [node, attrs] of [
      [item.filter, { width, height }],
      [item.image, { width, height }],
    ]) {
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    }
    item.image.setAttribute('href', displacementMap(width, height, item.radius, item.bezel));
    item.displace.setAttribute('scale', String(item.scale));
    item.blur.setAttribute('stdDeviation', String(Math.max(0.01, this.blur * 0.6)));
    this._apply(element);
  }

  _apply(element) {
    const item = this.items.get(element);
    if (!item) return;
    const value = this.enabled && item.width ? `url(#${item.id})` : '';
    element.style.backdropFilter = value;
    element.style.webkitBackdropFilter = value;
    element.classList.toggle('is-liquid', Boolean(value));
  }
}
