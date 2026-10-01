import { createEffectsChain } from './effects.js';
import { encodeAudio } from './encoder-client.js';

const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

const abortError = () => new DOMException('Export cancelled', 'AbortError');

/**
 * Renders the track (optionally only the cut selection, optionally with every effect
 * applied) through an OfflineAudioContext, then encodes it to WAV or MP3.
 */
export async function exportAudio({
  buffer,
  region = null,
  fx = null,
  format = 'wav',
  bitDepth = 16,
  bitrate = 320,
  tags = {},
  onProgress = () => {},
  signal,
}) {
  const start = region ? region.start : 0;
  const end = region ? region.end : buffer.duration;
  let sampleRate = buffer.sampleRate;
  if (format === 'mp3' && !MP3_RATES.includes(sampleRate)) sampleRate = sampleRate > 48000 ? 48000 : 44100;

  let channels;
  if (fx || sampleRate !== buffer.sampleRate) {
    channels = await renderOffline({ buffer, start, end, fx, sampleRate, signal, onProgress: (p) => onProgress('render', p) });
  } else {
    channels = sliceChannels(buffer, start, end);
    onProgress('render', 1);
  }
  if (signal?.aborted) throw abortError();

  return encodeAudio({ format, channels, sampleRate, bitDepth, bitrate, tags }, (p) => onProgress('encode', p), signal);
}

function sliceChannels(buffer, start, end) {
  const from = Math.max(0, Math.floor(start * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  const out = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) out.push(buffer.getChannelData(c).slice(from, Math.max(from + 1, to)));
  return out;
}

async function renderOffline({ buffer, start, end, fx, sampleRate, signal, onProgress }) {
  const rate = fx ? fx.rate : 1;
  const sourceDuration = end - start;
  const tail = fx && fx.reverb > 0 ? fx.decay + 0.3 : 0.02;
  const nominal = Math.ceil((sourceDuration / rate) * sampleRate);
  const length = Math.max(1, nominal + Math.ceil(tail * sampleRate));
  const numChannels = fx ? 2 : Math.min(2, buffer.numberOfChannels);
  const ctx = new OfflineAudioContext(numChannels, length, sampleRate);

  const source = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate });
  if (fx) {
    const chain = createEffectsChain(ctx, fx, { immediate: true });
    source.connect(chain.input);
    chain.output.connect(ctx.destination);
  } else {
    source.connect(ctx.destination);
  }
  source.start(0, start, sourceDuration);

  // OfflineAudioContext has no progress event, so suspend at checkpoints to report it.
  const quanta = Math.floor(length / 128);
  const steps = Math.min(48, Math.floor(quanta / 4));
  for (let i = 1; i < steps; i++) {
    const at = (Math.floor((quanta * i) / steps) * 128) / sampleRate;
    ctx
      .suspend(at)
      .then(() => {
        onProgress(i / steps);
        return ctx.resume();
      })
      .catch(() => {});
  }

  const rendered = await ctx.startRendering();
  onProgress(1);
  if (signal?.aborted) throw abortError();
  return trimTail(rendered, nominal);
}

/** Drops the silent part of the reverb tail so exports end where the sound actually ends. */
function trimTail(rendered, nominal) {
  const data = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) data.push(rendered.getChannelData(c));
  let last = nominal;
  for (let i = rendered.length - 1; i >= nominal; i--) {
    if (data.some((d) => Math.abs(d[i]) > 1e-4)) {
      last = i + 1;
      break;
    }
  }
  const end = Math.min(rendered.length, last + Math.round(0.05 * rendered.sampleRate));
  return data.map((d) => d.slice(0, Math.max(1, end)));
}
