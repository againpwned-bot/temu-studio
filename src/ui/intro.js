import { el } from '../utils/dom.js';

const PHRASES = ['click anywhere to enter', 'turn it up', 'slowed + reverb ready', 'bass boost armed'];

/**
 * guns.lol style "click to enter" splash. The click doubles as the user gesture that
 * unlocks Web Audio. On enter, the veil fades away and the app springs in.
 */
export function runIntro(root, { onEnter }) {
  return new Promise((resolve) => {
    const title = root.querySelector('#intro-title');
    const text = title.textContent.trim();
    title.setAttribute('aria-label', text);
    title.replaceChildren(
      ...[...text].map((ch, i) =>
        el('span', { class: 'intro-char', style: { '--i': String(i) }, 'aria-hidden': 'true', text: ch === ' ' ? ' ' : ch }),
      ),
    );

    const typer = root.querySelector('#intro-typer');
    let phrase = 0;
    let pos = 0;
    let deleting = false;
    let timer = 0;
    const tick = () => {
      const target = PHRASES[phrase];
      if (!deleting) {
        pos++;
        typer.textContent = target.slice(0, pos);
        if (pos >= target.length) {
          deleting = true;
          timer = setTimeout(tick, 1900);
          return;
        }
        timer = setTimeout(tick, 55 + Math.random() * 55);
      } else {
        pos--;
        typer.textContent = target.slice(0, pos);
        if (pos <= 0) {
          deleting = false;
          phrase = (phrase + 1) % PHRASES.length;
          timer = setTimeout(tick, 380);
          return;
        }
        timer = setTimeout(tick, 26);
      }
    };
    timer = setTimeout(tick, 1100);

    root.tabIndex = 0;
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', 'Enter temu studio');
    root.classList.add('is-visible');
    root.focus({ preventScroll: true });

    const listeners = new AbortController();
    const enter = () => {
      clearTimeout(timer);
      listeners.abort();
      onEnter();
      root.classList.add('is-leaving');
      setTimeout(() => root.remove(), 1400);
      resolve();
    };
    root.addEventListener('click', () => enter(), { signal: listeners.signal });
    root.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        enter();
      },
      { signal: listeners.signal },
    );
  });
}
