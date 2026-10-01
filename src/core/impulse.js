import { mulberry32 } from '../utils/noise.js';

const cache = new Map();

/**
 * Returns a cached stereo reverb impulse response. AudioBuffers are not tied to a context,
 * so the same buffer is shared between live playback and offline export renders.
 */
export function getImpulse(sampleRate, decay) {
  const seconds = Math.round(decay * 10) / 10;
  const key = `${sampleRate}:${seconds}`;
  let buffer = cache.get(key);
  if (!buffer) {
    buffer = createImpulse(sampleRate, seconds);
    cache.set(key, buffer);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
  }
  return buffer;
}

function createImpulse(sampleRate, decay) {
  const preDelay = Math.round(0.02 * sampleRate);
  const tail = Math.max(1, Math.round(decay * sampleRate));
  const length = preDelay + tail;
  const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
  const fadeIn = Math.round(0.004 * sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rand = mulberry32(0x5eed + ch * 977 + Math.round(decay * 100));

    // A handful of early reflections gives the room a sense of size before the diffuse tail.
    for (let k = 0; k < 10; k++) {
      const at = preDelay + Math.floor((0.003 + rand() * 0.075) * sampleRate);
      if (at < length) data[at] += (rand() * 2 - 1) * 0.5 * (1 - k / 12);
    }

    // Exponentially decaying noise that gets darker over time, like air absorbing highs.
    let lowpassed = 0;
    for (let i = 0; i < tail; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp((-6.9 * t) / decay);
      const damping = 0.1 + 0.82 * Math.min(1, t / decay);
      lowpassed += (rand() * 2 - 1 - lowpassed) * (1 - damping);
      const ramp = i < fadeIn ? i / fadeIn : 1;
      data[preDelay + i] += lowpassed * envelope * ramp;
    }
  }
  return buffer;
}
