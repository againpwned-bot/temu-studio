import { $, el } from '../utils/dom.js';
import { FX_DEFAULTS, FX_PRESETS } from '../core/effects.js';
import { GlassSlider } from './slider.js';
import { bindSwitch } from './switch.js';

const SLIDERS = [
  {
    key: 'rate',
    label: 'Speed',
    hint: 'pitch follows',
    min: 0.5,
    max: 2,
    step: 0.01,
    origin: 1,
    snaps: [1],
    format: (v) => `${v.toFixed(2)}×`,
  },
  {
    key: 'bass',
    label: 'Bass boost',
    hint: 'low shelf + sub',
    min: 0,
    max: 18,
    step: 0.5,
    format: (v) => (v ? `+${v.toFixed(1)} dB` : 'off'),
  },
  {
    key: 'reverb',
    label: 'Reverb',
    hint: 'wet mix',
    min: 0,
    max: 1,
    step: 0.01,
    format: (v) => (v ? `${Math.round(v * 100)}%` : 'off'),
  },
  {
    key: 'decay',
    label: 'Room size',
    hint: 'reverb tail',
    min: 0.5,
    max: 8,
    step: 0.1,
    format: (v) => `${v.toFixed(1)} s`,
  },
];

/**
 * Effects tab. `onInput` fires continuously while dragging/gliding (live audio), `onCommit`
 * on release. Room size only commits on release because it rebuilds the reverb impulse.
 */
export class FxPanel {
  constructor(root, { values, onInput, onCommit }) {
    this.onInput = onInput;
    this.onCommit = onCommit;
    this.sliders = {};
    this.outputs = {};
    this.presetButtons = [];
    this.laptopCard = $('#laptop-card', root);

    const list = $('#fx-list', root);
    for (const def of SLIDERS) {
      const output = el('output', { class: 'fx-value', text: def.format(values[def.key]) });
      const sliderRoot = el('div');
      const row = el('div', { class: 'fx', dataset: { fx: def.key } }, [
        el('div', { class: 'fx-head' }, [el('span', { class: 'fx-label' }, [def.label, el('small', { text: def.hint })]), output]),
        sliderRoot,
      ]);
      list.append(row);
      this.outputs[def.key] = { output, format: def.format };
      this.sliders[def.key] = new GlassSlider(sliderRoot, {
        ...def,
        value: values[def.key],
        defaultValue: FX_DEFAULTS[def.key],
        label: def.label,
        onInput: (v) => {
          output.textContent = def.format(v);
          if (def.key !== 'decay') this.onInput({ [def.key]: v });
          this._markPreset();
        },
        onChange: (v) => this.onCommit({ [def.key]: v }),
      });
    }

    const presets = $('#presets', root);
    for (const preset of FX_PRESETS) {
      const button = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', dataset: { preset: preset.id }, text: preset.label });
      button.addEventListener('click', () => this.apply(preset.fx));
      presets.append(button);
      this.presetButtons.push({ button, preset });
    }

    this.laptop = bindSwitch($('#laptop-switch', root), {
      checked: values.laptop,
      onChange: (on) => {
        this.laptopCard.classList.toggle('is-on', on);
        this.onCommit({ laptop: on });
      },
    });
    this.laptopCard.classList.toggle('is-on', values.laptop);
    this._markPreset();
  }

  /** Glides every slider to the new values; the audio follows the glide for a smooth tape-style change. */
  apply(fx) {
    for (const [key, slider] of Object.entries(this.sliders)) {
      if (key in fx) slider.setValue(fx[key], { animate: true, silent: false });
    }
    if ('decay' in fx) this.onCommit({ decay: fx.decay });
    if ('laptop' in fx) {
      this.laptop.set(fx.laptop);
      this.laptopCard.classList.toggle('is-on', fx.laptop);
      this.onCommit({ laptop: fx.laptop });
    }
    setTimeout(() => this.onCommit(this.values()), 560);
  }

  values() {
    const out = {};
    for (const [key, slider] of Object.entries(this.sliders)) out[key] = slider.value;
    out.laptop = this.laptop.checked;
    return out;
  }

  _markPreset() {
    const current = {};
    for (const [key, slider] of Object.entries(this.sliders)) current[key] = slider.value;
    for (const { button, preset } of this.presetButtons) {
      const match = Object.entries(preset.fx).every(([k, v]) => (k === 'decay' && !preset.fx.reverb ? true : Math.abs(current[k] - v) < 0.011));
      button.setAttribute('aria-pressed', String(match));
    }
  }
}
