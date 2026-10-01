import { $, el, icon } from '../utils/dom.js';
import { DEFAULT_SETTINGS, FONTS, THEMES } from '../core/settings.js';
import { Overlay } from './overlay.js';
import { GlassSlider } from './slider.js';
import { bindSwitch } from './switch.js';

const DISPLAY_FONTS = ['Unbounded Variable', 'Syne Variable', 'Sora Variable', 'Space Grotesk Variable', 'Outfit Variable'];

const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['← →', 'Seek 5s (Shift: 15s)'],
  ['↑ ↓', 'Volume'],
  ['N / P', 'Next / previous'],
  ['L', 'Cycle loop mode'],
  ['S', 'Shuffle'],
  ['M', 'Mute'],
  ['C', 'Cut mode'],
  ['E', 'Export'],
  [',', 'Settings'],
];

/** Settings drawer, built from a small schema. Every control writes straight into the Settings store. */
export class SettingsPanel {
  constructor(root, { settings, scrim, liquidSupported }) {
    this.settings = settings;
    this.liquidSupported = liquidSupported;
    this.controls = new Map();
    this.themeButtons = [];
    this.overlay = new Overlay(root, { scrim });
    this.body = $('#settings-body', root);
    this._build();
    settings.on('change', (patch, values) => this._sync(patch, values));
  }

  open() {
    this.overlay.open();
  }

  close() {
    this.overlay.close();
  }

  _build() {
    const v = this.settings.values;
    this.body.append(
      this._section('Theme', 'palette', [this._themes(v)]),
      this._section('Colors', 'droplet', [
        this._color('accent', 'Accent'),
        this._color('accent2', 'Accent 2'),
        this._color('text', 'Text'),
        this._color('glassTint', 'Glass tint'),
      ]),
      this._section('Sky & clouds', 'cloud', [
        this._color('skyTop', 'Sky top'),
        this._color('skyMid', 'Sky middle'),
        this._color('skyHorizon', 'Horizon'),
        this._color('cloudColor', 'Cloud color'),
        this._slider('cloudDensity', 'Cloud density', { min: 0, max: 1, step: 0.01, format: (x) => `${Math.round(x * 100)}%` }),
        this._slider('cloudSpeed', 'Cloud drift', { min: 0, max: 3, step: 0.05, format: (x) => (x ? `${x.toFixed(2)}×` : 'still') }),
        this._switch('stars', 'Stars'),
        this._switch('sun', 'Sun glow'),
      ]),
      this._section('Typography', 'type', [
        this._fonts('font', 'Body font', FONTS),
        this._fonts(
          'displayFont',
          'Title font',
          FONTS.filter((f) => DISPLAY_FONTS.includes(f.id)),
        ),
        this._slider('uiScale', 'Text size', { min: 0.85, max: 1.2, step: 0.01, format: (x) => `${Math.round(x * 100)}%` }),
      ]),
      this._section('Glass', 'sparkles', [
        this._slider('glassBlur', 'Blur', { min: 0, max: 40, step: 1, format: (x) => `${Math.round(x)} px` }),
        this._slider('glassAlpha', 'Tint strength', { min: 0, max: 0.85, step: 0.01, format: (x) => `${Math.round(x * 100)}%` }),
        this._slider('radius', 'Corner radius', { min: 8, max: 40, step: 1, format: (x) => `${Math.round(x)} px` }),
        this._switch(
          'refraction',
          'Liquid refraction',
          this.liquidSupported ? 'Edges bend the sky like real glass' : 'Needs a Chromium browser (Chrome, Edge, Brave)',
          !this.liquidSupported,
        ),
      ]),
      this._section('Motion', 'zap', [
        this._switch('intro', 'Intro screen', 'Click-to-enter splash on load'),
        this._switch('tilt', '3D card tilt'),
        this._switch('sparkles', 'Cursor sparkles'),
        this._switch('reduceMotion', 'Reduce motion'),
      ]),
      this._section('Shortcuts', 'keyboard', [
        el(
          'dl',
          { class: 'shortcuts' },
          SHORTCUTS.flatMap(([key, label]) => [el('dt', {}, [el('kbd', { text: key })]), el('dd', { text: label })]),
        ),
      ]),
      el('div', { class: 'set-footer' }, [
        el('button', { class: 'btn btn-glass', type: 'button', onclick: () => this.settings.reset() }, [icon('reset'), el('span', { text: 'Reset everything' })]),
      ]),
    );
  }

  _section(title, iconName, children) {
    return el('section', { class: 'set-section' }, [el('h3', { class: 'set-title' }, [icon(iconName), title]), ...children]);
  }

  _themes(v) {
    const grid = el('div', { class: 'theme-grid' });
    for (const [id, theme] of Object.entries(THEMES)) {
      const preview = el('span', { class: 'theme-preview' });
      for (const [prop, value] of Object.entries({
        '--t-top': theme.skyTop,
        '--t-mid': theme.skyMid,
        '--t-hor': theme.skyHorizon,
        '--t-cloud': theme.cloudColor,
        '--t-a': theme.accent,
        '--t-b': theme.accent2,
      })) {
        preview.style.setProperty(prop, value);
      }
      const button = el('button', { class: 'theme-opt', type: 'button', 'aria-pressed': String(v.theme === id), dataset: { theme: id } }, [
        preview,
        el('span', { text: theme.label }),
      ]);
      button.addEventListener('click', () => this.settings.applyTheme(id));
      grid.append(button);
      this.themeButtons.push(button);
    }
    return grid;
  }

  _color(key, label) {
    const value = this.settings.values[key];
    const input = el('input', { type: 'color', value, 'aria-label': label });
    const swatch = el('span', { class: 'swatch', style: { '--c': value } }, [input]);
    const hex = el('span', { class: 'color-hex', text: value });
    input.addEventListener('input', () => {
      swatch.style.setProperty('--c', input.value);
      hex.textContent = input.value;
      this.settings.set({ [key]: input.value, theme: 'custom' });
    });
    this.controls.set(key, (val) => {
      if (input.value !== val) input.value = val;
      swatch.style.setProperty('--c', val);
      hex.textContent = val;
    });
    return el('label', { class: 'set-row' }, [el('span', { class: 'set-label', text: label }), hex, swatch]);
  }

  _slider(key, label, opts) {
    const output = el('output', { class: 'set-value', text: opts.format(this.settings.values[key]) });
    const host = el('div');
    const slider = new GlassSlider(host, {
      ...opts,
      label,
      value: this.settings.values[key],
      defaultValue: DEFAULT_SETTINGS[key],
      onInput: (x) => {
        output.textContent = opts.format(x);
        this.settings.set({ [key]: x });
      },
    });
    this.controls.set(key, (val) => {
      output.textContent = opts.format(val);
      slider.setValue(val, { animate: true });
    });
    return el('div', { class: 'set-slider' }, [el('div', { class: 'set-slider-head' }, [el('span', { class: 'set-label', text: label }), output]), host]);
  }

  _switch(key, label, description = '', disabled = false) {
    const id = `set-${key}`;
    const button = el('button', { class: 'switch', type: 'button', role: 'switch', id, 'aria-labelledby': `${id}-label`, disabled });
    const control = bindSwitch(button, {
      checked: this.settings.values[key] && !disabled,
      onChange: (on) => this.settings.set({ [key]: on }),
    });
    this.controls.set(key, (val) => control.set(val && !disabled));
    return el('div', { class: 'set-row' }, [
      el('span', { class: 'set-label', id: `${id}-label` }, [label, description ? el('small', { text: description }) : null]),
      button,
    ]);
  }

  _fonts(key, label, fonts) {
    const buttons = fonts.map((f) => {
      const button = el('button', { class: 'font-opt', type: 'button', 'aria-pressed': String(this.settings.values[key] === f.id), dataset: { font: f.id } }, [
        el('span', { class: 'font-aa', text: 'Aa' }),
        el('span', { class: 'font-name', text: f.label }),
      ]);
      button.style.fontFamily = `'${f.id}', system-ui, sans-serif`;
      button.addEventListener('click', () => this.settings.set({ [key]: f.id }));
      return button;
    });
    this.controls.set(key, (val) => {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.font === val));
    });
    return el('div', { class: 'set-block' }, [el('span', { class: 'set-label set-label--block', text: label }), el('div', { class: 'font-grid', role: 'group', 'aria-label': label }, buttons)]);
  }

  _sync(patch, values) {
    for (const key of Object.keys(patch)) this.controls.get(key)?.(values[key]);
    if ('theme' in patch) {
      for (const button of this.themeButtons) button.setAttribute('aria-pressed', String(button.dataset.theme === values.theme));
    }
  }
}
