import { el, icon } from '../utils/dom.js';
import { coverGradient } from '../utils/color.js';
import { formatTime } from '../utils/format.js';

export class QueueView {
  constructor({ list, empty, count, onSelect, onRemove }) {
    this.list = list;
    this.empty = empty;
    this.count = count;
    this.seen = new Set();
    list.addEventListener('click', (e) => {
      const item = e.target.closest('.q-item');
      if (!item) return;
      const id = Number(item.dataset.id);
      if (e.target.closest('.q-remove')) onRemove(id);
      else if (e.target.closest('.q-main')) onSelect(id);
    });
  }

  render(tracks, currentIndex, playing) {
    let fresh = 0;
    const items = tracks.map((track, i) => {
      const isNew = !this.seen.has(track.id);
      this.seen.add(track.id);
      const classes = ['q-item'];
      if (i === currentIndex) classes.push('is-current');
      if (i === currentIndex && playing) classes.push('is-playing');
      if (isNew) classes.push('is-new');
      if (track.error) classes.push('has-error');

      const art = el('span', { class: 'q-art' }, [el('span', { class: 'q-eq', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')])]);
      art.style.background = track.cover ? `center / cover no-repeat url("${track.cover}")` : coverGradient(`${track.title}|${track.artist}`);

      return el('li', { class: classes.join(' '), dataset: { id: String(track.id) }, style: { '--i': String(isNew ? fresh++ : 0) } }, [
        el('button', { class: 'q-main', type: 'button', 'aria-label': `Play ${track.title}`, 'aria-current': i === currentIndex ? 'true' : null }, [
          art,
          el('span', { class: 'q-text' }, [el('strong', { text: track.title }), el('small', { text: track.error ? 'Could not decode' : track.artist || 'Unknown artist' })]),
          el('span', { class: 'q-time', text: track.duration ? formatTime(track.duration) : '' }),
        ]),
        el('button', { class: 'q-remove', type: 'button', 'aria-label': `Remove ${track.title}` }, [icon('x')]),
      ]);
    });
    this.list.replaceChildren(...items);
    this.empty.hidden = tracks.length > 0;
    this.count.textContent = String(tracks.length);
    const ids = new Set(tracks.map((t) => t.id));
    for (const id of this.seen) if (!ids.has(id)) this.seen.delete(id);
  }
}
