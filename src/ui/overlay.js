import { $$ } from '../utils/dom.js';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared open/close behaviour for the settings drawer and export modal: focus trap, Esc, restore focus. */
export class Overlay {
  constructor(element, { scrim = null, onOpen = () => {}, onClose = () => {} } = {}) {
    this.el = element;
    this.scrim = scrim;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.isOpen = false;
    this.lastFocus = null;
    this._onKey = (e) => this._key(e);
    element.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) this.close();
      else if (e.target === element && element.classList.contains('modal')) this.close();
    });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.lastFocus = document.activeElement;
    this.el.inert = false;
    this.el.setAttribute('aria-hidden', 'false');
    this.el.classList.add('is-open');
    this.scrim?.classList.add('is-on');
    document.addEventListener('keydown', this._onKey, true);
    this.onOpen();
    requestAnimationFrame(() => {
      const items = this._focusables();
      (items.find((n) => !n.hasAttribute('data-close')) ?? items[0])?.focus({ preventScroll: true });
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('is-open');
    this.scrim?.classList.remove('is-on');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.inert = true;
    document.removeEventListener('keydown', this._onKey, true);
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus({ preventScroll: true });
    this.onClose();
  }

  _focusables() {
    return $$(FOCUSABLE, this.el).filter((n) => n.getClientRects().length > 0);
  }

  _key(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = this._focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
