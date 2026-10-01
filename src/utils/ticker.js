/** One shared requestAnimationFrame loop. It only runs while something is subscribed. */
const subscribers = new Set();
let frame = 0;
let last = 0;

function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  for (const fn of subscribers) fn(dt, now);
  frame = subscribers.size ? requestAnimationFrame(loop) : 0;
}

export function onFrame(fn) {
  subscribers.add(fn);
  if (!frame) {
    last = performance.now();
    frame = requestAnimationFrame(loop);
  }
  return () => subscribers.delete(fn);
}

/** Runs `fn(dt)` every frame until it returns true (settled). Returns a cancel function. */
export function animate(fn) {
  const off = onFrame((dt, now) => {
    if (fn(dt, now)) off();
  });
  return off;
}
