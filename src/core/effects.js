import { getImpulse } from './impulse.js';

export const FX_DEFAULTS = Object.freeze({ rate: 1, bass: 0, reverb: 0, decay: 2.8, laptop: false });

export const FX_PRESETS = [
  { id: 'original', label: 'Original', fx: { rate: 1, bass: 0, reverb: 0, decay: 2.8 } },
  { id: 'slowed', label: 'Slowed + Reverb', fx: { rate: 0.85, bass: 3, reverb: 0.38, decay: 3.8 } },
  { id: 'nightcore', label: 'Nightcore', fx: { rate: 1.25, bass: 0, reverb: 0.06, decay: 1.6 } },
  { id: 'bass', label: 'Bass Boosted', fx: { rate: 1, bass: 12, reverb: 0, decay: 2.8 } },
  { id: 'vapor', label: 'Vaporwave', fx: { rate: 0.78, bass: 4, reverb: 0.5, decay: 5.5 } },
];

const dbToGain = (db) => 10 ** (db / 20);

/** Transparent below -0.5 dBFS, then a tanh knee that can never exceed 0 dBFS. */
function safetyCurve(samples = 4096) {
  const curve = new Float32Array(samples);
  const knee = 0.94;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return curve;
}

/** Soft saturation with an even-order term: turns sub-bass into harmonics small speakers can play. */
function harmonicCurve(samples = 2048) {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(2.2 * x) * 0.8 + 0.25 * x * x;
  }
  return curve;
}

/**
 * Builds the full effects graph on any BaseAudioContext, so live playback and the
 * offline exporter run the exact same processing.
 *
 * input → bass shelf → headroom → (dry + convolver) → [bypass | laptop speaker voicing] → limiter → output
 */
export function createEffectsChain(ctx, params = FX_DEFAULTS, { immediate = false } = {}) {
  const input = new GainNode(ctx);

  const lowShelf = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 110, gain: 0 });
  const subPeak = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 58, Q: 0.9, gain: 0 });
  const headroom = new GainNode(ctx);

  const dry = new GainNode(ctx);
  const wet = new GainNode(ctx, { gain: 0 });
  const convolver = new ConvolverNode(ctx);
  const sum = new GainNode(ctx);

  const lapBypass = new GainNode(ctx);
  const lapWet = new GainNode(ctx, { gain: 0 });
  const lapOut = new GainNode(ctx);
  // 4th-order Butterworth high-pass: laptop drivers can't reproduce this range, it only eats headroom.
  const hp1 = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 120, Q: 0.5412 });
  const hp2 = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 120, Q: 1.3066 });
  const boxCut = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 380, Q: 1.1, gain: -2.5 });
  const presence = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 3000, Q: 0.8, gain: 3 });
  const air = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 9500, gain: 1.5 });
  const vbIsolate = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 150, Q: 0.707 });
  const vbDrive = new GainNode(ctx, { gain: 4 });
  const vbShaper = new WaveShaperNode(ctx, { curve: harmonicCurve(), oversample: '2x' });
  const vbHigh = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 170, Q: 0.707 });
  const vbLow = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 700, Q: 0.707 });
  const vbLevel = new GainNode(ctx, { gain: 0.45 });
  const lapComp = new DynamicsCompressorNode(ctx, { threshold: -20, knee: 10, ratio: 3, attack: 0.005, release: 0.2 });
  const lapTrim = new GainNode(ctx, { gain: 1.1 });

  const limiter = new DynamicsCompressorNode(ctx, { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.1 });
  // The compressor can overshoot on fast transients; this catches whatever gets through.
  const safety = new WaveShaperNode(ctx, { curve: safetyCurve() });
  const output = new GainNode(ctx);

  input.connect(lowShelf).connect(subPeak).connect(headroom);
  headroom.connect(dry).connect(sum);
  headroom.connect(convolver).connect(wet).connect(sum);
  sum.connect(lapBypass).connect(lapOut);
  sum.connect(hp1).connect(hp2).connect(boxCut).connect(presence).connect(air).connect(lapComp);
  sum.connect(vbIsolate).connect(vbDrive).connect(vbShaper).connect(vbHigh).connect(vbLow).connect(vbLevel).connect(lapComp);
  lapComp.connect(lapTrim).connect(lapWet).connect(lapOut);
  lapOut.connect(limiter).connect(safety).connect(output);

  const state = { ...FX_DEFAULTS };
  let loadedDecay = null;

  const set = (param, value, now) => {
    if (immediate) param.value = value;
    else param.setTargetAtTime(value, now, 0.025);
  };

  function update(next) {
    Object.assign(state, next);
    const now = ctx.currentTime;
    set(lowShelf.gain, state.bass, now);
    set(subPeak.gain, state.bass * 0.35, now);
    set(headroom.gain, dbToGain(-state.bass * 0.55), now);

    const decay = Math.round(state.decay * 10) / 10;
    if (state.reverb > 0 && decay !== loadedDecay) {
      convolver.buffer = getImpulse(ctx.sampleRate, decay);
      loadedDecay = decay;
    }
    set(dry.gain, 1 - state.reverb * 0.5, now);
    set(wet.gain, state.reverb * 1.15, now);

    set(lapBypass.gain, state.laptop ? 0 : 1, now);
    set(lapWet.gain, state.laptop ? 1 : 0, now);
  }

  update(params);
  return { input, output, update };
}
