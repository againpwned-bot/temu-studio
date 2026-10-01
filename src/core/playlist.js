import { Emitter } from '../utils/emitter.js';

let nextId = 1;

export class Playlist extends Emitter {
  constructor() {
    super();
    this.tracks = [];
    this.index = -1;
    this.shuffle = false;
    this.order = [];
  }

  get current() {
    return this.tracks[this.index] ?? null;
  }

  indexOf(id) {
    return this.tracks.findIndex((t) => t.id === id);
  }

  add(items) {
    const added = items.map((item) => ({ id: nextId++, ...item }));
    this.tracks.push(...added);
    this._reorder();
    this.emit('change');
    return added;
  }

  /** Returns true when the removed track was the one loaded. */
  remove(id) {
    const i = this.indexOf(id);
    if (i === -1) return false;
    const wasCurrent = i === this.index;
    this.tracks.splice(i, 1);
    if (i < this.index) this.index -= 1;
    else if (wasCurrent) this.index = -1;
    this._reorder();
    this.emit('change');
    return wasCurrent;
  }

  clear() {
    this.tracks = [];
    this.index = -1;
    this.order = [];
    this.emit('change');
  }

  select(index) {
    this.index = index;
    this.emit('change');
  }

  setShuffle(on) {
    this.shuffle = on;
    this._reorder();
    this.emit('change');
  }

  /** Next index in play order (direction = 1 / -1), or -1 when there is nowhere to go. */
  step(direction, wrap) {
    const n = this.order.length;
    if (!n) return -1;
    const position = this.order.indexOf(this.index);
    if (position === -1) return this.order[0];
    let next = position + direction;
    if (next >= n || next < 0) {
      if (!wrap) return -1;
      if (this.shuffle && direction > 0 && n > 2) {
        this._reorder();
        next = 1;
      } else next = (next + n) % n;
    }
    return this.order[next];
  }

  _reorder() {
    const order = this.tracks.map((_, i) => i);
    if (this.shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const at = order.indexOf(this.index);
      if (at > 0) {
        order.splice(at, 1);
        order.unshift(this.index);
      }
    }
    this.order = order;
  }
}
