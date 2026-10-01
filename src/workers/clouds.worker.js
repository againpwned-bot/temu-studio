import { createNoise3D } from '../utils/noise.js';

/**
 * Generates one horizontally seamless cloud-bank texture.
 * Noise is sampled on a cylinder (cos/sin of x) so the left and right edges tile perfectly.
 * Output: `density` (raw cloud field, 0..255) and `shade` (lighting, 0..255).
 */
self.onmessage = ({ data }) => {
  const { id, width, height, seed, feature } = data;
  const noise = createNoise3D(seed);
  const size = width * height;
  const raw = new Float32Array(size);
  const radius = width / (2 * Math.PI * feature);
  const cos = new Float32Array(width);
  const sin = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const a = (x / width) * Math.PI * 2;
    cos[x] = Math.cos(a) * radius;
    sin[x] = Math.sin(a) * radius;
  }

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const ny = (y / feature) * 1.35;
    const profile = (v - 0.5) * 2.6;
    for (let x = 0; x < width; x++) {
      const cx = cos[x];
      const cz = sin[x];
      const warp = noise(cx * 0.6 + 11.3, ny * 0.6, cz * 0.6) * 0.55;
      let f = 0;
      let amp = 0.6;
      let freq = 1;
      for (let o = 0; o < 5; o++) {
        f += amp * noise(cx * freq + warp, ny * freq + warp * 0.5, cz * freq);
        amp *= 0.5;
        freq *= 2.02;
      }
      raw[y * width + x] = f + profile;
    }
  }

  const density = new Uint8Array(size);
  const shade = new Uint8Array(size);
  const k = Math.max(2, Math.round(height * 0.035));
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const r = raw[i];
      density[i] = Math.max(0, Math.min(255, Math.round(((r + 1.2) / 3) * 255)));
      const above = y >= k ? raw[i - k * width] : r - 0.5;
      const s = 0.5 + (r - above) * 1.1 + (0.5 - v) * 0.35 - Math.max(0, r - 0.4) * 0.25;
      shade[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
    }
  }

  self.postMessage({ id, density, shade }, [density.buffer, shade.buffer]);
};
