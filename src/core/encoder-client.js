let worker = null;
let seq = 0;
const pending = new Map();

function failAll(message) {
  for (const job of pending.values()) job.reject(new Error(message));
  pending.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/encoder.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    if (data.type === 'progress') job.onProgress(data.value);
    else if (data.type === 'done') {
      pending.delete(data.id);
      job.resolve(new Blob([data.buffer], { type: data.mime }));
    } else if (data.type === 'error') {
      pending.delete(data.id);
      job.reject(new Error(data.message));
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    failAll(event.message || 'Encoder crashed');
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Encodes channel data to a WAV or MP3 Blob in a worker. Channel arrays are transferred (not copied). */
export function encodeAudio(job, onProgress = () => {}, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Export cancelled', 'AbortError'));
      return;
    }
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress });
    const w = getWorker();
    w.postMessage({ id, ...job }, job.channels.map((c) => c.buffer));
    signal?.addEventListener(
      'abort',
      () => {
        if (!pending.has(id)) return;
        pending.delete(id);
        failAll('Export cancelled');
        w.terminate();
        if (worker === w) worker = null;
        reject(new DOMException('Export cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}
