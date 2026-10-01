import { Mp3Encoder } from '@breezystack/lamejs';

/**
 * Encodes rendered PCM off the main thread so the UI stays at 60fps during export.
 * in:  { id, format: 'wav'|'mp3', channels: Float32Array[], sampleRate, bitDepth, bitrate, tags }
 * out: { id, type: 'progress', value } | { id, type: 'done', buffer, mime } | { id, type: 'error', message }
 */
self.onmessage = (event) => {
  const job = event.data;
  const report = (value) => self.postMessage({ id: job.id, type: 'progress', value });
  try {
    const buffer =
      job.format === 'mp3'
        ? encodeMp3(job.channels, job.sampleRate, job.bitrate, job.tags, report)
        : encodeWav(job.channels, job.sampleRate, job.bitDepth, report);
    self.postMessage(
      { id: job.id, type: 'done', buffer, mime: job.format === 'mp3' ? 'audio/mpeg' : 'audio/wav' },
      [buffer],
    );
  } catch (error) {
    self.postMessage({ id: job.id, type: 'error', message: error?.message || String(error) });
  }
};

/** Triangular dither keeps quiet fades and reverb tails smooth when truncating to 16-bit. */
function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const dither = (Math.random() - Math.random()) / 32768;
    const s = Math.max(-1, Math.min(1, samples[i] + dither));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function encodeWav(channels, sampleRate, bitDepth, report) {
  const numChannels = channels.length;
  const length = channels[0].length;
  const float = bitDepth === 32;
  const bytes = bitDepth / 8;
  const blockAlign = numChannels * bytes;
  const dataSize = length * blockAlign;
  const fmtSize = float ? 18 : 16;
  const factSize = float ? 12 : 0;
  const headerSize = 12 + 8 + fmtSize + factSize + 8;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  writeString(view, 8, 'WAVE');
  let p = 12;
  writeString(view, p, 'fmt ');
  view.setUint32(p + 4, fmtSize, true);
  view.setUint16(p + 8, float ? 3 : 1, true);
  view.setUint16(p + 10, numChannels, true);
  view.setUint32(p + 12, sampleRate, true);
  view.setUint32(p + 16, sampleRate * blockAlign, true);
  view.setUint16(p + 20, blockAlign, true);
  view.setUint16(p + 22, bitDepth, true);
  if (float) view.setUint16(p + 24, 0, true);
  p += 8 + fmtSize;
  if (float) {
    writeString(view, p, 'fact');
    view.setUint32(p + 4, 4, true);
    view.setUint32(p + 8, length, true);
    p += 12;
  }
  writeString(view, p, 'data');
  view.setUint32(p + 4, dataSize, true);
  p += 8;

  const reportEvery = 1 << 17;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = channels[c][i];
      if (float) {
        view.setFloat32(p, sample, true);
      } else if (bitDepth === 16) {
        const s = Math.max(-1, Math.min(1, sample + (Math.random() - Math.random()) / 32768));
        view.setInt16(p, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
      } else {
        const s = Math.max(-1, Math.min(1, sample));
        const v = s < 0 ? Math.round(s * 8388608) : Math.round(s * 8388607);
        view.setUint8(p, v & 0xff);
        view.setUint8(p + 1, (v >> 8) & 0xff);
        view.setUint8(p + 2, (v >> 16) & 0xff);
      }
      p += bytes;
    }
    if (i % reportEvery === 0) report(i / length);
  }
  report(1);
  return buffer;
}

function id3Frame(id, text) {
  const body = [0x01, 0xff, 0xfe];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    body.push(code & 0xff, code >> 8);
  }
  const size = body.length;
  return [...id].map((c) => c.charCodeAt(0)).concat([(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff, 0, 0], body);
}

function buildId3(tags = {}) {
  const frames = [];
  if (tags.title) frames.push(...id3Frame('TIT2', tags.title));
  if (tags.artist) frames.push(...id3Frame('TPE1', tags.artist));
  frames.push(...id3Frame('TSSE', 'temu studio'));
  const size = frames.length;
  const header = [0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f];
  return new Uint8Array([...header, ...frames]);
}

function encodeMp3(channels, sampleRate, bitrate, tags, report) {
  const stereo = channels.length > 1;
  const encoder = new Mp3Encoder(stereo ? 2 : 1, sampleRate, bitrate);
  const left = toInt16(channels[0]);
  const right = stereo ? toInt16(channels[1]) : null;
  const block = 1152 * 8;
  const parts = [buildId3(tags)];
  let total = parts[0].length;

  const push = (chunk) => {
    if (chunk && chunk.length) {
      const copy = new Uint8Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length));
      parts.push(copy);
      total += copy.length;
    }
  };

  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block);
    push(stereo ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l));
    if ((i / block) % 24 === 0) report(i / left.length);
  }
  push(encoder.flush());
  report(1);

  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
}
