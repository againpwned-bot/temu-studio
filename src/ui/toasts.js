import { el, icon } from '../utils/dom.js';

const ICONS = { info: 'sparkles', success: 'check', error: 'x' };

export class Toasts {
  constructor(root) {
    this.root = root;
  }

  show(message, { type = 'info', duration = 2600 } = {}) {
    const toast = el('div', { class: `toast glass toast--${type}` }, [
      el('span', { class: 'toast-icon' }, [icon(ICONS[type] ?? 'sparkles')]),
      el('span', { class: 'toast-text', text: message }),
    ]);
    this.root.append(toast);
    while (this.root.children.length > 3) this.root.firstElementChild.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('is-in')));
    setTimeout(() => {
      toast.classList.remove('is-in');
      toast.classList.add('is-out');
      setTimeout(() => toast.remove(), 450);
    }, duration);
  }
}
