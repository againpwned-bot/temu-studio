import { Emitter } from '../utils/emitter.js';
import { debounce, loadJSON, saveJSON } from '../utils/storage.js';

const KEY = 'temu-studio:settings:v1';

export const THEMES = {
  daydream: {
    label: 'Daydream',
    accent: '#7cc8ff',
    accent2: '#b59bff',
    text: '#f7f9ff',
    glassTint: '#0d1626',
    skyTop: '#1f5fcf',
    skyMid: '#4d92ec',
    skyHorizon: '#a9d4ff',
    cloudColor: '#ffffff',
    stars: false,
    sun: true,
  },
  sunset: {
    label: 'Sunset',
    accent: '#ffad7a',
    accent2: '#ff6f91',
    text: '#fff6f0',
    glassTint: '#2a1020',
    skyTop: '#2c2763',
    skyMid: '#b4507a',
    skyHorizon: '#ffb26b',
    cloudColor: '#ffc9b5',
    stars: false,
    sun: true,
  },
  midnight: {
    label: 'Midnight',
    accent: '#8fb7ff',
    accent2: '#c19bff',
    text: '#eef2ff',
    glassTint: '#060a18',
    skyTop: '#03050f',
    skyMid: '#0c1636',
    skyHorizon: '#26396e',
    cloudColor: '#46548a',
    stars: true,
    sun: false,
  },
  vapor: {
    label: 'Vaporwave',
    accent: '#7ef6ff',
    accent2: '#ff7ec7',
    text: '#fff4fd',
    glassTint: '#1a0b2e',
    skyTop: '#170a33',
    skyMid: '#5b2a8c',
    skyHorizon: '#ff86c2',
    cloudColor: '#9af1ff',
    stars: true,
    sun: true,
  },
  bloodmoon: {
    label: 'Blood Moon',
    accent: '#ff3b5c',
    accent2: '#ff9a8a',
    text: '#fff0f2',
    glassTint: '#0b0204',
    skyTop: '#030102',
    skyMid: '#1d0509',
    skyHorizon: '#561019',
    cloudColor: '#4a1420',
    stars: true,
    sun: false,
  },
  mint: {
    label: 'Mint',
    accent: '#7affc8',
    accent2: '#7ad7ff',
    text: '#f2fffa',
    glassTint: '#06201f',
    skyTop: '#0b3a46',
    skyMid: '#2a8b88',
    skyHorizon: '#bff3df',
    cloudColor: '#f2fffb',
    stars: false,
    sun: true,
  },
};

export const FONTS = [
  { id: 'Outfit Variable', label: 'Outfit' },
  { id: 'Inter Variable', label: 'Inter' },
  { id: 'Space Grotesk Variable', label: 'Space Grotesk' },
  { id: 'Sora Variable', label: 'Sora' },
  { id: 'Syne Variable', label: 'Syne' },
  { id: 'Unbounded Variable', label: 'Unbounded' },
  { id: 'JetBrains Mono Variable', label: 'JetBrains Mono' },
];

export function themeColors(id) {
  const colors = { ...THEMES[id] };
  delete colors.label;
  return colors;
}

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'daydream',
  ...themeColors('daydream'),
  font: 'Outfit Variable',
  displayFont: 'Unbounded Variable',
  uiScale: 1,
  glassAlpha: 0.3,
  glassBlur: 22,
  radius: 28,
  cloudDensity: 0.55,
  cloudSpeed: 1,
  refraction: true,
  intro: true,
  tilt: true,
  sparkles: true,
  reduceMotion: false,
});

export class Settings extends Emitter {
  constructor() {
    super();
    const stored = loadJSON(KEY, {});
    this.values = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (stored && typeof stored[key] === typeof DEFAULT_SETTINGS[key]) this.values[key] = stored[key];
    }
    this._save = debounce(() => saveJSON(KEY, this.values), 250);
  }

  set(patch) {
    const changed = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS) || this.values[key] === value) continue;
      this.values[key] = value;
      changed[key] = value;
    }
    if (!Object.keys(changed).length) return;
    this._save();
    this.emit('change', changed, this.values);
  }

  applyTheme(id) {
    if (!THEMES[id]) return;
    this.set({ ...themeColors(id), theme: id });
  }

  reset() {
    this.set({ ...DEFAULT_SETTINGS });
  }
}
