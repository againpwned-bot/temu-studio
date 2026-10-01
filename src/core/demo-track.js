import { mulberry32 } from '../utils/noise.js';

/** A ~37s lo-fi loop synthesised offline, so the player has something to show off without any files. */

const BPM = 84;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 12;
const START = 0.08;

const CHORDS = [
  [53, 57, 60, 64, 67],
  [52, 55, 59, 62, 66],
  [50, 53, 57, 60, 64],
  [48, 52, 55, 59, 62],
];
const ROOTS = [41, 40, 38, 36];
const SCALE = [69, 72, 74, 76, 79, 81, 84];
const RHYTHMS = [
  [0, 0.75, 1.5, 2.5],
  [0.5, 1, 2, 3],
  [0, 1.5, 2, 2.75, 3.5],
  [0.25, 1, 2.5],
];

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function makeNoise(ctx, seconds, rand) {
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: Math.round(seconds * ctx.sampleRate), sampleRate: ctx.sampleRate });
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  return buffer;
}

function makeVinyl(ctx, seconds, rand) {
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: Math.round(seconds * ctx.sampleRate), sampleRate: ctx.sampleRate });
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const hiss = (rand() * 2 - 1) * 0.006;
      data[i] = rand() < 0.0003 ? (rand() * 2 - 1) * (0.25 + rand() * 0.6) : hiss;
    }
  }
  return buffer;
}

export async function renderDemoTrack(sampleRate = 48000) {
  const duration = START + BARS * BAR + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const rand = mulberry32(84);
  const noise = makeNoise(ctx, 2, rand);

  const master = new GainNode(ctx, { gain: 0.9 });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 11000, Q: 0.4 });
  master.connect(tone).connect(ctx.destination);

  const keysLevel = 0.3;
  const keysBus = new GainNode(ctx, { gain: keysLevel });
  keysBus.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2400, Q: 0.6 })).connect(master);
  const bassBus = new GainNode(ctx, { gain: 0.5 });
  bassBus.connect(master);
  const drumBus = new GainNode(ctx, { gain: 0.75 });
  drumBus.connect(master);

  const leadBus = new GainNode(ctx, { gain: 0.14 });
  leadBus.connect(master);
  const echoL = new DelayNode(ctx, { delayTime: BEAT * 0.75, maxDelayTime: 2 });
  const echoR = new DelayNode(ctx, { delayTime: BEAT * 0.75, maxDelayTime: 2 });
  const feedback = new GainNode(ctx, { gain: 0.38 });
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  leadBus.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3200 })).connect(echoL);
  echoL.connect(echoR);
  echoR.connect(feedback).connect(echoL);
  echoL.connect(merger, 0, 0);
  echoR.connect(merger, 0, 1);
  merger.connect(new GainNode(ctx, { gain: 0.5 })).connect(master);

  const vinyl = new AudioBufferSourceNode(ctx, { buffer: makeVinyl(ctx, 3.3, rand), loop: true });
  vinyl.connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 900 })).connect(new GainNode(ctx, { gain: 0.22 })).connect(master);
  vinyl.start(0);

  function keyNote(midi, t, dur, pan) {
    const f = mtof(midi);
    const env = new GainNode(ctx, { gain: 0 });
    env.connect(new StereoPannerNode(ctx, { pan })).connect(keysBus);
    const partials = [
      [1, 'sine', 0.6],
      [2, 'sine', 0.16],
      [1.003, 'triangle', 0.2],
      [3, 'sine', 0.04],
    ];
    for (const [mult, type, level] of partials) {
      const osc = new OscillatorNode(ctx, { type, frequency: f * mult });
      osc.connect(new GainNode(ctx, { gain: level })).connect(env);
      osc.start(t);
      osc.stop(t + dur + 0.8);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.015);
    env.gain.setTargetAtTime(0.5, t + 0.015, 0.45);
    env.gain.setTargetAtTime(0, t + dur, 0.16);
  }

  function bassNote(midi, t, dur) {
    const f = mtof(midi);
    const env = new GainNode(ctx, { gain: 0 });
    env.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 320 })).connect(bassBus);
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: f });
    const body = new OscillatorNode(ctx, { type: 'triangle', frequency: f });
    osc.connect(env);
    body.connect(new GainNode(ctx, { gain: 0.3 })).connect(env);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.02);
    env.gain.setTargetAtTime(0.7, t + 0.02, 0.3);
    env.gain.setTargetAtTime(0, t + dur, 0.06);
    for (const o of [osc, body]) {
      o.start(t);
      o.stop(t + dur + 0.5);
    }
  }

  function kick(t) {
    const osc = new OscillatorNode(ctx, { type: 'sine', frequency: 150 });
    const env = new GainNode(ctx, { gain: 0 });
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(env).connect(drumBus);
    osc.start(t);
    osc.stop(t + 0.55);
    keysBus.gain.setValueAtTime(keysLevel * 0.45, t);
    keysBus.gain.setTargetAtTime(keysLevel, t + 0.02, 0.14);
  }

  function snare(t) {
    const src = new AudioBufferSourceNode(ctx, { buffer: noise });
    const env = new GainNode(ctx, { gain: 0 });
    src.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1900, Q: 0.7 })).connect(env).connect(drumBus);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.6, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.start(t, rand() * 1.5);
    src.stop(t + 0.25);

    const body = new OscillatorNode(ctx, { type: 'triangle', frequency: 220 });
    const bodyEnv = new GainNode(ctx, { gain: 0 });
    body.frequency.setValueAtTime(220, t);
    body.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    bodyEnv.gain.setValueAtTime(0, t);
    bodyEnv.gain.linearRampToValueAtTime(0.28, t + 0.003);
    bodyEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    body.connect(bodyEnv).connect(drumBus);
    body.start(t);
    body.stop(t + 0.15);
  }

  function hat(t, velocity, open) {
    const src = new AudioBufferSourceNode(ctx, { buffer: noise });
    const env = new GainNode(ctx, { gain: 0 });
    src
      .connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 7500 }))
      .connect(env)
      .connect(new StereoPannerNode(ctx, { pan: 0.25 }))
      .connect(drumBus);
    const decay = open ? 0.22 : 0.04;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.2 * velocity, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.start(t, rand() * 1.5);
    src.stop(t + decay + 0.02);
  }

  function pluck(midi, t) {
    const f = mtof(midi);
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 4200, Q: 1.5 });
    const env = new GainNode(ctx, { gain: 0 });
    filter.frequency.setValueAtTime(4200, t);
    filter.frequency.setTargetAtTime(900, t, 0.12);
    filter.connect(env).connect(new StereoPannerNode(ctx, { pan: (rand() - 0.5) * 0.6 })).connect(leadBus);
    const tri = new OscillatorNode(ctx, { type: 'triangle', frequency: f });
    const sine = new OscillatorNode(ctx, { type: 'sine', frequency: f * 2 });
    tri.connect(filter);
    sine.connect(new GainNode(ctx, { gain: 0.3 })).connect(filter);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    for (const o of [tri, sine]) {
      o.start(t);
      o.stop(t + 0.95);
    }
  }

  for (let bar = 0; bar < BARS; bar++) {
    const t = START + bar * BAR;
    const ci = bar % 4;
    const chord = CHORDS[ci];
    const last = bar === BARS - 1;

    chord.forEach((m, i) => keyNote(m, t + i * 0.014, last ? BAR * 1.4 : BAR * 0.96, (i / (chord.length - 1) - 0.5) * 0.6));
    if (bar >= 2 && !last && bar % 2 === 1) {
      chord.slice(1, 4).forEach((m, i) => keyNote(m + 12, t + BEAT * 2.5 + i * 0.01, BEAT * 1.1, 0.3 - i * 0.3));
    }

    if (bar >= 1) {
      bassNote(ROOTS[ci], t, BEAT * 1.5);
      if (!last) {
        bassNote(ROOTS[ci], t + BEAT * 2.5, BEAT * 0.9);
        bassNote(ROOTS[ci] + 7, t + BEAT * 3.5, BEAT * 0.45);
      }
    }

    if (bar >= 2 && !last) {
      kick(t);
      kick(t + BEAT * 2.5);
      if (bar % 2 === 1) kick(t + BEAT * 1.75);
      snare(t + BEAT);
      snare(t + BEAT * 3);
      for (let s = 0; s < 8; s++) {
        const swing = s % 2 ? BEAT * 0.09 : 0;
        hat(t + (s * BEAT) / 2 + swing, s % 2 ? 0.55 : 0.9, s === 7 && bar % 4 === 3);
      }
    }

    if (bar >= 4 && !last) {
      for (const beat of RHYTHMS[bar % RHYTHMS.length]) {
        pluck(SCALE[Math.floor(rand() * SCALE.length)], t + beat * BEAT);
      }
    }
  }

  const rendered = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak > 0) {
    const gain = 0.89 / peak;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] *= gain;
    }
  }
  return rendered;
}
