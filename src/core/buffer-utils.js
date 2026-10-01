/**
 * Waveform data: a blend of RMS (body) and peak (transients) per bucket, normalised to 0..1.
 * Strided sampling keeps this a few milliseconds even for long tracks.
 */
export function computePeaks(buffer, buckets = 2048) {
  const length = buffer.length;
  const count = Math.max(1, Math.min(buckets, length));
  const peaks = new Float32Array(count);
  const channels = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
  const size = length / count;
  const stride = Math.max(1, Math.floor(size / 240));
  let max = 0;

  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * size);
    const end = Math.min(length, Math.max(start + 1, Math.floor((i + 1) * size)));
    let peak = 0;
    let sum = 0;
    let n = 0;
    for (const data of channels) {
      for (let j = start; j < end; j += stride) {
        const v = data[j];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        sum += v * v;
        n++;
      }
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    const value = peak * 0.35 + rms * 1.4 * 0.65;
    peaks[i] = value;
    if (value > max) max = value;
  }
  if (max > 0) for (let i = 0; i < count; i++) peaks[i] = (peaks[i] / max) ** 0.85;
  return peaks;
}

/** Copies a time range into a new buffer with 4ms fades so the cut points never click. */
export function sliceBuffer(buffer, start, end) {
  const sr = buffer.sampleRate;
  const from = Math.max(0, Math.floor(start * sr));
  const to = Math.min(buffer.length, Math.ceil(end * sr));
  const length = Math.max(1, to - from);
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length, sampleRate: sr });
  const fade = Math.min(Math.floor(length / 2), Math.round(0.004 * sr));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c).slice(from, from + length);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      data[i] *= g;
      data[length - 1 - i] *= g;
    }
    out.copyToChannel(data, c);
  }
  return out;
}
