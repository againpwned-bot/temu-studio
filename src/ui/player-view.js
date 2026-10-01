import { $, el, reducedMotion } from '../utils/dom.js';
import { coverGradient } from '../utils/color.js';
import { formatRate, formatTime } from '../utils/format.js';

const LOOP_LABELS = { off: 'Loop off', all: 'Loop all', one: 'Loop one' };

/** Owns the "profile" side of the card: cover + disc, title, artist, badges and transport states. */
export class PlayerView {
  constructor() {
    this.card = $('#player');
    this.glow = $('#card-glow');
    this.disc = $('#disc');
    this.discLabel = $('#disc-label');
    this.sleeve = $('#sleeve');
    this.art = $('#cover-art');
    this.fallback = $('#cover-fallback');
    this.eyebrow = $('#eyebrow');
    this.title = $('#title-text');
    this.artist = $('#artist');
    this.badges = $('#badges');
    this.timeCurrent = $('#time-current');
    this.timeTotal = $('#time-total');
    this.playButton = $('#btn-play');
    this.loopButton = $('#btn-loop');
    this.shuffleButton = $('#btn-shuffle');
    this.muteButton = $('#btn-mute');

    this.angle = 0;
    this.spin = 0;
    this.energy = 0;
    this.glowBase = 0;
    this.typer = 0;
    this.titleTimer = 0;
    this.lastCurrent = '';
    this.lastTotal = '';
    this.idle = false;
  }

  setTrack(track) {
    this.card.classList.toggle('is-empty', !track);
    this._swapTitle(track ? track.title : 'Drop a track to begin');
    this._type(track ? track.artist || 'Unknown artist' : 'or take the demo for a spin');
    this.setCover(track);
    this.setBadges(track);
  }

  setCover(track) {
    const gradient = coverGradient(track ? `${track.title}|${track.artist}` : 'temu studio');
    this.sleeve.style.setProperty('--cover', gradient);
    if (track?.cover) {
      this.art.src = track.cover;
      this.art.hidden = false;
      this.fallback.hidden = true;
      this.discLabel.style.background = `center / cover no-repeat url("${track.cover}")`;
    } else {
      this.art.hidden = true;
      this.art.removeAttribute('src');
      this.fallback.hidden = false;
      this.discLabel.style.background = gradient;
    }
  }

  setBadges(track) {
    const items = [];
    if (track) {
      if (track.format) items.push(track.format);
      if (track.sampleRate) items.push(formatRate(track.sampleRate));
      if (track.channels) items.push(track.channels === 1 ? 'Mono' : 'Stereo');
      if (track.duration) items.push(formatTime(track.duration));
      if (track.edited) items.push('Cut');
    }
    this.badges.replaceChildren(...items.map((text, i) => el('span', { class: 'badge', style: { '--i': String(i) }, text })));
  }

  setStatus(text) {
    if (this.eyebrow.textContent !== text) this.eyebrow.textContent = text;
  }

  setPlaying(playing) {
    this.card.classList.toggle('is-playing', playing);
    this.playButton.classList.toggle('is-playing', playing);
    this.playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  setLoop(mode) {
    this.loopButton.dataset.mode = mode;
    this.loopButton.dataset.tip = LOOP_LABELS[mode];
    this.loopButton.setAttribute('aria-label', LOOP_LABELS[mode]);
    this.loopButton.classList.remove('is-popping');
    void this.loopButton.offsetWidth;
    this.loopButton.classList.add('is-popping');
  }

  setShuffle(on) {
    this.shuffleButton.setAttribute('aria-pressed', String(on));
  }

  setVolume(volume, muted) {
    const silent = muted || volume === 0;
    this.muteButton.classList.toggle('is-muted', silent);
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  setTime(current, total) {
    const a = formatTime(current);
    const b = formatTime(total);
    if (a !== this.lastCurrent) {
      this.lastCurrent = a;
      this.timeCurrent.textContent = a;
    }
    if (b !== this.lastTotal) {
      this.lastTotal = b;
      this.timeTotal.textContent = b;
    }
  }

  /** Per-frame: vinyl spin (eases up/down like a real platter) and the bass-reactive glow. */
  frame(dt, playing, rate, energy, entered) {
    const targetSpin = playing ? 200 * rate : 0;
    this.spin += (targetSpin - this.spin) * (1 - Math.exp(-dt * (playing ? 2.2 : 3)));
    this.energy += (energy.bass - this.energy) * (1 - Math.exp(-dt * 14));
    this.glowBase += ((entered ? 0.3 : 0) - this.glowBase) * (1 - Math.exp(-dt * 2));

    const still = Math.abs(this.spin) < 0.05 && this.energy < 0.002 && Math.abs(this.glowBase - (entered ? 0.3 : 0)) < 0.002;
    if (still && this.idle) return;
    this.idle = still;

    if (Math.abs(this.spin) >= 0.05) {
      this.angle = (this.angle + this.spin * dt) % 360;
      this.disc.style.transform = `rotate(${this.angle.toFixed(2)}deg)`;
    }
    const e = reducedMotion() ? 0 : this.energy;
    this.glow.style.opacity = Math.min(1, this.glowBase + e * 0.85).toFixed(3);
    this.glow.style.transform = `scale(${(1 + e * 0.1).toFixed(4)})`;
    this.sleeve.style.scale = (1 + e * 0.035).toFixed(4);
  }

  _swapTitle(text) {
    if (this.title.textContent === text) return;
    this.title.title = text;
    clearTimeout(this.titleTimer);
    if (reducedMotion()) {
      this.title.textContent = text;
      return;
    }
    this.title.classList.add('is-out');
    this.titleTimer = setTimeout(() => {
      this.title.textContent = text;
      this.title.classList.remove('is-out');
      this.title.classList.add('is-in');
      requestAnimationFrame(() => requestAnimationFrame(() => this.title.classList.remove('is-in')));
    }, 200);
  }

  _type(text) {
    clearInterval(this.typer);
    if (this.artist.dataset.full === text) return;
    this.artist.dataset.full = text;
    if (reducedMotion()) {
      this.artist.textContent = text;
      return;
    }
    let i = 0;
    this.artist.textContent = '';
    this.typer = setInterval(() => {
      i++;
      this.artist.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(this.typer);
    }, 32);
  }
}
