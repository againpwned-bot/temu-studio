import { Emitter } from '../utils/emitter.js';
import { clamp } from '../utils/dom.js';
import { createEffectsChain, FX_DEFAULTS } from './effects.js';

const FADE = 0.012;
const MIN_REGION = 0.1;

/**
 * Buffer-based player. Every play/seek spawns a short-lived AudioBufferSourceNode with a
 * tiny gain envelope, so seeking crossfades instead of clicking. playbackRate on the
 * source changes speed and pitch together (tape style).
 */
export class AudioEngine extends Emitter {
  constructor() {
    super();
    this.ctx = null;
    this.chain = null;
    this.analyser = null;
    this.master = null;
    this.buffer = null;
    this.fx = { ...FX_DEFAULTS };
    this.volume = 0.8;
    this.muted = false;
    this.loopMode = 'off';
    this.region = null;
    this.playing = false;
    this._voice = null;
    this._anchor = null;
    this._prevAnchor = null;
    this._pausedAt = 0;
    this._freq = null;
    this._energy = { bass: 0, level: 0 };
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.chain = createEffectsChain(ctx, this.fx);
    this.analyser = new AnalyserNode(ctx, { fftSize: 1024, smoothingTimeConstant: 0.8 });
    this.master = new GainNode(ctx, { gain: this._targetVolume() });
    this.chain.output.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(ctx.destination);
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
    return ctx;
  }

  async unlock() {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Resume can be rejected without a user gesture; the next play() retries.
      }
    }
  }

  decode(arrayBuffer) {
    return this.ensureContext().decodeAudioData(arrayBuffer);
  }

  get sampleRate() {
    return this.ensureContext().sampleRate;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  bounds() {
    if (!this.buffer) return [0, 0];
    return this.region ? [this.region.start, this.region.end] : [0, this.buffer.duration];
  }

  load(buffer, { autoplay = false, position = 0 } = {}) {
    this._stopVoice();
    this.playing = false;
    this.buffer = buffer;
    this.region = null;
    this._pausedAt = clamp(position, 0, buffer.duration);
    this.emit('load', buffer);
    if (autoplay) this.play();
    else this.emit('pause');
  }

  unload() {
    this._stopVoice();
    this.playing = false;
    this.buffer = null;
    this.region = null;
    this._pausedAt = 0;
    this.emit('pause');
    this.emit('unload');
  }

  play() {
    if (!this.buffer || this.playing) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const [lo, hi] = this.bounds();
    let at = this._pausedAt;
    if (at < lo || at >= hi - 0.02) at = lo;
    this.playing = true;
    this._startVoice(at);
    this.emit('play');
  }

  pause() {
    if (!this.playing) return;
    this._pausedAt = this._positionAt(this.ctx.currentTime);
    this._stopVoice();
    this.playing = false;
    this.emit('pause');
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time) {
    if (!this.buffer) return;
    const [lo, hi] = this.bounds();
    const t = clamp(time, lo, hi);
    if (this.playing) {
      if (t >= hi - 0.01) {
        if (this.loopMode === 'one') this._replaceVoice(lo);
        else {
          this._stopVoice();
          this._finish();
          return;
        }
      } else this._replaceVoice(t);
    } else this._pausedAt = t;
    this.emit('seek', t);
  }

  setRate(rate) {
    this.fx.rate = rate;
    if (!this.playing || !this._voice) return;
    const now = this.ctx.currentTime;
    const position = this._positionAt(now);
    this._prevAnchor = this._anchor;
    this._anchor = { ...this._anchor, ctxTime: now, offset: position, rate };
    this._voice.source.playbackRate.setValueAtTime(rate, now);
  }

  setFx(patch) {
    if ('rate' in patch) this.setRate(patch.rate);
    Object.assign(this.fx, patch);
    this.chain?.update(this.fx);
  }

  setVolume(volume) {
    this.volume = clamp(volume, 0, 1);
    this._applyVolume();
  }

  setMuted(muted) {
    this.muted = muted;
    this._applyVolume();
  }

  setLoopMode(mode) {
    const wasLooping = this.loopMode === 'one';
    this.loopMode = mode;
    if (this.playing && wasLooping !== (mode === 'one')) {
      this._replaceVoice(this._positionAt(this.ctx.currentTime));
    }
  }

  setRegion(region) {
    const before = this.bounds();
    let next = null;
    if (region && this.buffer) {
      const d = this.buffer.duration;
      let start = clamp(Math.min(region.start, region.end), 0, d);
      let end = clamp(Math.max(region.start, region.end), 0, d);
      if (end - start < MIN_REGION) {
        end = Math.min(d, start + MIN_REGION);
        start = Math.max(0, end - MIN_REGION);
      }
      next = { start, end };
    }
    this.region = next;
    const [lo, hi] = this.bounds();
    if (this.playing) {
      if (before[0] !== lo || before[1] !== hi) {
        const position = this._positionAt(this.ctx.currentTime);
        this._replaceVoice(position >= lo && position < hi - 0.02 ? position : lo);
      }
    } else {
      this._pausedAt = clamp(this._pausedAt, lo, hi);
    }
    this.emit('region', this.region);
  }

  /** Playback position in buffer seconds, latency compensated for drawing. */
  get currentTime() {
    if (!this.playing || !this.ctx) return this._pausedAt;
    return this._positionAt(this._audibleTime());
  }

  getEnergy() {
    const energy = this._energy;
    if (!this.analyser || !this.playing) {
      energy.bass = 0;
      energy.level = 0;
      return energy;
    }
    const f = this._freq;
    this.analyser.getByteFrequencyData(f);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const bassEnd = Math.max(2, Math.round(160 / binHz));
    let bass = 0;
    for (let i = 1; i <= bassEnd; i++) bass += f[i];
    const levelEnd = Math.min(f.length, Math.round(5000 / binHz));
    let level = 0;
    for (let i = 0; i < levelEnd; i++) level += f[i];
    energy.bass = bass / (bassEnd * 255);
    energy.level = level / (levelEnd * 255);
    return energy;
  }

  _audibleTime() {
    const ctx = this.ctx;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) {
        const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        return Math.min(t, ctx.currentTime);
      }
    }
    return ctx.currentTime;
  }

  _positionAt(ctxTime) {
    let anchor = this._anchor;
    if (!anchor) return this._pausedAt;
    if (ctxTime < anchor.ctxTime && this._prevAnchor && ctxTime >= this._prevAnchor.ctxTime) anchor = this._prevAnchor;
    let position = anchor.offset + Math.max(0, ctxTime - anchor.ctxTime) * anchor.rate;
    if (anchor.loop) {
      const length = anchor.hi - anchor.lo;
      if (position >= anchor.hi && length > 0) position = anchor.lo + ((position - anchor.lo) % length);
    }
    return Math.min(position, anchor.hi);
  }

  _startVoice(offset) {
    const ctx = this.ctx;
    const [lo, hi] = this.bounds();
    const loop = this.loopMode === 'one';
    const start = clamp(offset, lo, Math.max(lo, hi - 0.001));
    const source = new AudioBufferSourceNode(ctx, { buffer: this.buffer, playbackRate: this.fx.rate });
    const envelope = new GainNode(ctx, { gain: 0 });
    source.connect(envelope);
    envelope.connect(this.chain.input);

    const t0 = ctx.currentTime + 0.004;
    envelope.gain.setValueAtTime(0, t0);
    envelope.gain.linearRampToValueAtTime(1, t0 + FADE);
    if (loop) {
      source.loop = true;
      source.loopStart = lo;
      source.loopEnd = hi;
      source.start(t0, start);
    } else {
      source.start(t0, start, Math.max(0, hi - start));
    }

    const voice = { source, envelope };
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      if (this._voice === voice) {
        this._voice = null;
        this._anchor = null;
        this._finish();
      }
    };
    this._voice = voice;
    this._anchor = { ctxTime: t0, offset: start, rate: this.fx.rate, loop, lo, hi };
    this._prevAnchor = null;
  }

  _stopVoice() {
    const voice = this._voice;
    if (!voice) return;
    this._voice = null;
    this._anchor = null;
    this._prevAnchor = null;
    const t = this.ctx.currentTime;
    const gain = voice.envelope.gain;
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(gain.value, t);
    gain.linearRampToValueAtTime(0, t + FADE);
    try {
      voice.source.stop(t + FADE + 0.01);
    } catch {
      // The source already stopped on its own.
    }
  }

  _replaceVoice(at) {
    this._stopVoice();
    this._startVoice(at);
  }

  _finish() {
    this.playing = false;
    this._pausedAt = this.bounds()[1];
    this.emit('ended');
  }

  _targetVolume() {
    return this.muted ? 0 : this.volume ** 2;
  }

  _applyVolume() {
    if (this.master) this.master.gain.setTargetAtTime(this._targetVolume(), this.ctx.currentTime, 0.03);
  }
}
