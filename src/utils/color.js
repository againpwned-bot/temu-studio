const clampByte = (v) => Math.min(255, Math.max(0, Math.round(v)));

export function isHex(value) {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value).trim());
}

export function hexToRgb(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')}`;
}

export const mixRgb = (a, b, t) => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

export const scaleRgb = (c, k) => ({ r: c.r * k, g: c.g * k, b: c.b * k });

export function luminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Stable hue (0-359) from any string, used for generated cover art. */
export function hashHue(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

export function coverGradient(seed) {
  const a = hashHue(seed || 'temu');
  const b = (a + 50 + (hashHue(`${seed}!`) % 80)) % 360;
  return `radial-gradient(circle at 28% 24%, hsl(${a} 95% 78% / .95), transparent 55%), linear-gradient(135deg, hsl(${a} 80% 58%), hsl(${b} 75% 42%))`;
}
