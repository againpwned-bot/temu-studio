import { $, clamp } from './utils/dom.js';
import { onFrame } from './utils/ticker.js';
import { debounce, loadJSON, saveJSON } from './utils/storage.js';
import { formatTime } from './utils/format.js';
import { AudioEngine } from './core/audio-engine.js';
import { Playlist } from './core/playlist.js';
import { Settings } from './core/settings.js';
import { FX_DEFAULTS } from './core/effects.js';
import { computePeaks, sliceBuffer } from './core/buffer-utils.js';
import { parseFilename, readTags } from './core/id3.js';
import { renderDemoTrack } from './core/demo-track.js';
import { exportAudio } from './core/exporter.js';
import { applyTheme, installSpringEasings } from './ui/theme.js';
import { LiquidGlass } from './ui/liquid-glass.js';
import { Sky } from './ui/sky.js';
import { Waveform } from './ui/waveform.js';
import { PlayerView } from './ui/player-view.js';
import { FxPanel } from './ui/fx-panel.js';
import { QueueView } from './ui/queue-view.js';
import { Segmented } from './ui/segmented.js';
import { GlassSlider } from './ui/slider.js';
import { SettingsPanel } from './ui/settings-panel.js';
import { ExportDialog } from './ui/export-dialog.js';
import { Toasts } from './ui/toasts.js';
import { Sparkles } from './ui/sparkles.js';
import { Tilt } from './ui/tilt.js';
import { runIntro } from './ui/intro.js';

const PLAYER_KEY = 'temu-studio:player:v1';
const PERF_KEY = 'temu-studio:perf-checked:v1';
const AUDIO_EXT = /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|webm|aif|aiff|mp4)$/i;
const LOOP_ORDER = ['off', 'all', 'one'];
const LOOP_TOASTS = { off: 'Loop off', all: 'Looping the queue', one: 'Looping this track' };

function sanitizeFx(saved) {
  const fx = { ...FX_DEFAULTS };
  if (!saved || typeof saved !== 'object') return fx;
  const ranges = { rate: [0.5, 2], bass: [0, 18], reverb: [0, 1], decay: [0.5, 8] };
  for (const [key, [lo, hi]] of Object.entries(ranges)) {
    if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) fx[key] = clamp(saved[key], lo, hi);
  }
  fx.laptop = saved.laptop === true;
  return fx;
}

function fileFormat(file) {
  const match = file.name.match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toUpperCase() : 'AUDIO';
}

export class App {
  constructor() {
    this.settings = new Settings();
    this.engine = new AudioEngine();
    this.playlist = new Playlist();
    const saved = loadJSON(PLAYER_KEY, {}) ?? {};
    this.state = {
      volume: typeof saved.volume === 'number' ? clamp(saved.volume, 0, 1) : 0.8,
      muted: saved.muted === true,
      loopMode: LOOP_ORDER.includes(saved.loopMode) ? saved.loopMode : 'off',
      shuffle: saved.shuffle === true,
      fx: sanitizeFx(saved.fx),
    };
    this.cutMode = false;
    this.loadToken = 0;
    this.loading = false;
    this.demoLoading = false;
    this.entered = false;
    this.saveState = debounce(() => saveJSON(PLAYER_KEY, this.state), 300);
  }

  async start() {
    installSpringEasings();
    const v = this.settings.values;
    applyTheme(v);

    this.toasts = new Toasts($('#toasts'));
    this.sky = new Sky($('#sky'));
    this.sky.configure(v);

    this.glass = new LiquidGlass($('#glass-filters'));
    this.glass.setBlur(v.glassBlur);
    this.glass.attach($('#player'), { radius: v.radius, bezel: 30, scale: 64 });
    this.glass.attach($('#topbar'), { radius: 999, bezel: 16, scale: 34, followRadius: false });
    this.glass.setEnabled(v.refraction);

    this.view = new PlayerView();
    this.waveform = new Waveform($('#wave'));
    this.waveform.setColors(v.accent, v.accent2);
    this.fxPanel = new FxPanel($('#panel-fx'), {
      values: this.state.fx,
      onInput: (patch) => this.setFx(patch),
      onCommit: (patch) => this.setFx(patch),
    });
    this.queueView = new QueueView({
      list: $('#queue-list'),
      empty: $('#queue-empty'),
      count: $('#queue-count'),
      onSelect: (id) => this.selectTrack(this.playlist.indexOf(id), { autoplay: true }),
      onRemove: (id) => this.removeTrack(id),
    });
    this.tabs = new Segmented($('#tabs'), { onChange: (value) => this.showPanel(value) });
    this.volumeSlider = new GlassSlider($('#volume-slider'), {
      min: 0,
      max: 1,
      step: 0.01,
      value: this.state.volume,
      defaultValue: 0.8,
      label: 'Volume',
      format: (x) => `${Math.round(x * 100)}%`,
      onInput: (x) => this.setVolume(x),
    });
    this.settingsPanel = new SettingsPanel($('#settings'), { settings: this.settings, scrim: $('#scrim'), liquidSupported: this.glass.supported });
    this.exportDialog = new ExportDialog($('#export'), {
      getContext: () => this.exportContext(),
      run: (opts) => this.runExport(opts),
      toasts: this.toasts,
    });
    this.sparkles = new Sparkles($('#sparkles'));
    this.sparkles.setColors(v.accent, v.accent2);
    this.tilt = new Tilt($('.card-wrap'), $('#player'), $('#glass-light'));
    this._applyMotion(v);

    this.engine.setVolume(this.state.volume);
    this.engine.setMuted(this.state.muted);
    this.engine.setLoopMode(this.state.loopMode);
    this.engine.setFx(this.state.fx);
    this.playlist.setShuffle(this.state.shuffle);
    this.view.setLoop(this.state.loopMode);
    this.view.setShuffle(this.state.shuffle);
    this.view.setVolume(this.state.volume, this.state.muted);

    this._bindEngine();
    this._bindUI();
    this._bindKeyboard();
    this._bindDrop();
    this._bindMediaSession();
    this.settings.on('change', (patch, values) => this._onSettings(patch, values));
    this._refreshControls();
    this._renderQueue();
    onFrame((dt) => this._frame(dt));

    const intro = $('#intro');
    if (v.intro) {
      await runIntro(intro, { onEnter: () => this.engine.unlock() });
    } else {
      intro.remove();
      const unlock = () => this.engine.unlock();
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
    this.entered = true;
    document.body.classList.add('is-entered');
    this._watchPerformance();
  }

  /**
   * One-time safety net: if this device can't hold ~24fps with SVG refraction on, fall back
   * to lite glass (plain frosted blur) and say so. Never runs again once decided.
   */
  _watchPerformance() {
    if (!this.glass.supported || !this.settings.values.refraction || loadJSON(PERF_KEY, false)) return;
    const startedAt = performance.now();
    let windowStart = 0;
    let frames = 0;
    let slowWindows = 0;
    const off = onFrame((_dt, now) => {
      if (document.hidden || now - startedAt < 2000) {
        windowStart = now;
        frames = 0;
        return;
      }
      frames++;
      if (now - windowStart < 1500) return;
      const fps = (frames * 1000) / (now - windowStart);
      slowWindows = fps < 24 ? slowWindows + 1 : 0;
      windowStart = now;
      frames = 0;
      if (slowWindows >= 2) {
        off();
        saveJSON(PERF_KEY, true);
        this.settings.set({ refraction: false });
        this.toasts.show('Switched to lite glass to keep things smooth (Settings → Glass)', { duration: 5200 });
      } else if (now - startedAt > 20000) {
        off();
        saveJSON(PERF_KEY, true);
      }
    });
  }

  /* ---------- tracks ---------- */

  async addFiles(fileList) {
    const files = [...(fileList ?? [])].filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
    if (!files.length) {
      this.toasts.show("That doesn't look like audio", { type: 'error' });
      return;
    }
    const added = this.playlist.add(
      files.map((file) => {
        const { title, artist } = parseFilename(file.name);
        return {
          file,
          title,
          artist,
          album: '',
          format: fileFormat(file),
          cover: null,
          buffer: null,
          original: null,
          peaks: null,
          duration: 0,
          sampleRate: 0,
          channels: 0,
          edited: false,
          generated: false,
          error: false,
        };
      }),
    );
    this.toasts.show(added.length === 1 ? `Added “${added[0].title}”` : `Added ${added.length} tracks`, { type: 'success' });
    for (const track of added) this._readTags(track);
    this._renderQueue();
    this._refreshControls();
    if (this.playlist.index === -1) await this.selectTrack(this.playlist.indexOf(added[0].id), { autoplay: true });
  }

  async _readTags(track) {
    if (!track.file || !(/\.mp3$/i.test(track.file.name) || track.file.type === 'audio/mpeg')) return;
    const tags = await readTags(track.file);
    if (!tags || !this.playlist.tracks.includes(track)) return;
    if (tags.title) track.title = tags.title;
    if (tags.artist) track.artist = tags.artist;
    if (tags.album) track.album = tags.album;
    if (tags.picture) track.cover = URL.createObjectURL(tags.picture);
    this._renderQueue();
    if (track === this.playlist.current) {
      this.view.setTrack(track);
      this._updateMediaSession();
      this._updateTitle();
    }
  }

  async selectTrack(index, { autoplay = true } = {}) {
    const track = this.playlist.tracks[index];
    if (!track) return;
    const token = ++this.loadToken;
    if (this.cutMode) this.setCutMode(false);
    this.engine.pause();
    this.playlist.select(index);
    this.view.setTrack(track);
    this._renderQueue();
    this._updateTitle();

    try {
      if (!track.buffer) {
        this.loading = true;
        this._updateStatus();
        this.waveform.setLoading(true);
        const data = await track.file.arrayBuffer();
        const buffer = await this.engine.decode(data);
        if (token !== this.loadToken) return;
        track.buffer = buffer;
        track.duration = buffer.duration;
        track.sampleRate = buffer.sampleRate;
        track.channels = buffer.numberOfChannels;
        track.peaks ??= computePeaks(buffer);
        track.error = false;
      }
      if (token !== this.loadToken) return;
      this._evictBuffers(track);
      this.engine.load(track.buffer, { autoplay });
      this.waveform.setData(track.peaks, track.duration);
      this.view.setBadges(track);
      this._updateMediaSession();
    } catch {
      if (token !== this.loadToken) return;
      track.error = true;
      this.engine.unload();
      this.waveform.clear();
      this.toasts.show(`Couldn't decode “${track.title}”`, { type: 'error' });
    } finally {
      if (token === this.loadToken) {
        this.loading = false;
        this.waveform.setLoading(false);
        this._refreshControls();
        this._renderQueue();
        this._updateStatus();
      }
    }
  }

  _evictBuffers(keep) {
    for (const t of this.playlist.tracks) {
      if (t !== keep && t.buffer && t.file && !t.edited) t.buffer = null;
    }
  }

  async loadDemo() {
    const existing = this.playlist.tracks.findIndex((t) => t.generated);
    if (existing !== -1) {
      this.selectTrack(existing, { autoplay: true });
      return;
    }
    if (this.demoLoading) return;
    this.demoLoading = true;
    this.engine.unlock();
    this.view.setStatus('building the demo…');
    this.waveform.setLoading(true);
    try {
      const buffer = await renderDemoTrack(this.engine.sampleRate);
      const [track] = this.playlist.add([
        {
          file: null,
          title: 'Cloud Nine',
          artist: 'temu studio',
          album: 'Demo',
          format: 'DEMO',
          cover: null,
          buffer,
          original: null,
          peaks: computePeaks(buffer),
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
          channels: buffer.numberOfChannels,
          edited: false,
          generated: true,
          error: false,
        },
      ]);
      await this.selectTrack(this.playlist.indexOf(track.id), { autoplay: true });
    } catch (error) {
      console.error(error);
      this.toasts.show('Could not build the demo track', { type: 'error' });
      this.waveform.setLoading(false);
    } finally {
      this.demoLoading = false;
    }
  }

  removeTrack(id) {
    const index = this.playlist.indexOf(id);
    const track = this.playlist.tracks[index];
    if (!track) return;
    const wasPlaying = this.engine.playing;
    const wasCurrent = this.playlist.remove(id);
    if (track.cover) URL.revokeObjectURL(track.cover);
    if (wasCurrent) {
      if (this.playlist.tracks.length) this.selectTrack(Math.min(index, this.playlist.tracks.length - 1), { autoplay: wasPlaying });
      else this._unloadAll();
    }
    this._renderQueue();
    this._refreshControls();
  }

  clearQueue() {
    if (!this.playlist.tracks.length) return;
    for (const t of this.playlist.tracks) if (t.cover) URL.revokeObjectURL(t.cover);
    this.playlist.clear();
    this._unloadAll();
    this.toasts.show('Queue cleared');
  }

  _unloadAll() {
    this.loadToken++;
    if (this.cutMode) this.setCutMode(false);
    this.engine.unload();
    this.waveform.clear();
    this.view.setTrack(null);
    this._renderQueue();
    this._refreshControls();
    this._updateStatus();
    this._updateTitle();
    this._updateMediaSession();
  }

  /* ---------- transport ---------- */

  togglePlay() {
    if (!this.engine.buffer) {
      if (this.playlist.tracks.length) this.selectTrack(Math.max(0, this.playlist.index), { autoplay: true });
      return;
    }
    this.engine.toggle();
  }

  next({ auto = false } = {}) {
    if (!this.playlist.tracks.length) return;
    const wrap = !auto || this.engine.loopMode === 'all';
    const index = this.playlist.step(1, wrap);
    if (index === -1) {
      this.engine.seek(this.engine.bounds()[0]);
      this.view.setPlaying(false);
      this._renderQueue();
      this._updateStatus();
      return;
    }
    if (index === this.playlist.index && this.engine.buffer) {
      this.engine.seek(this.engine.bounds()[0]);
      this.engine.play();
      return;
    }
    this.selectTrack(index, { autoplay: true });
  }

  prev() {
    if (!this.playlist.tracks.length) return;
    const [lo] = this.engine.bounds();
    if (this.engine.buffer && this.engine.currentTime - lo > 3) {
      this.engine.seek(lo);
      return;
    }
    const index = this.playlist.step(-1, true);
    if (index === -1 || index === this.playlist.index) this.engine.seek(lo);
    else this.selectTrack(index, { autoplay: true });
  }

  seekBy(seconds) {
    if (!this.engine.buffer) return;
    this.engine.seek(this.engine.currentTime + seconds);
  }

  cycleLoop() {
    const mode = LOOP_ORDER[(LOOP_ORDER.indexOf(this.state.loopMode) + 1) % LOOP_ORDER.length];
    this.state.loopMode = mode;
    this.engine.setLoopMode(mode);
    this.view.setLoop(mode);
    this.toasts.show(LOOP_TOASTS[mode], { duration: 1600 });
    this.saveState();
  }

  toggleShuffle() {
    this.state.shuffle = !this.state.shuffle;
    this.playlist.setShuffle(this.state.shuffle);
    this.view.setShuffle(this.state.shuffle);
    this.toasts.show(this.state.shuffle ? 'Shuffle on' : 'Shuffle off', { duration: 1600 });
    this.saveState();
  }

  setVolume(volume) {
    this.state.volume = clamp(volume, 0, 1);
    if (this.state.muted && volume > 0) {
      this.state.muted = false;
      this.engine.setMuted(false);
    }
    this.engine.setVolume(this.state.volume);
    this.view.setVolume(this.state.volume, this.state.muted);
    this.saveState();
  }

  toggleMute() {
    this.state.muted = !this.state.muted;
    this.engine.setMuted(this.state.muted);
    this.view.setVolume(this.state.volume, this.state.muted);
    this.saveState();
  }

  setFx(patch) {
    Object.assign(this.state.fx, patch);
    this.engine.setFx(patch);
    if ('laptop' in patch) this._updateStatus();
    this.saveState();
  }

  showPanel(value) {
    for (const panel of [$('#panel-fx'), $('#panel-queue')]) {
      const active = panel.id === `panel-${value}`;
      panel.classList.toggle('is-active', active);
      panel.classList.toggle('is-left', !active && value === 'queue');
      panel.inert = !active;
    }
  }

  /* ---------- cutting ---------- */

  setCutMode(on) {
    if (on && !this.engine.buffer) return;
    this.cutMode = on;
    $('#cut-toggle').setAttribute('aria-pressed', String(on));
    $('#cut-bar').classList.toggle('is-open', on);
    if (on) {
      this.engine.setRegion(this.engine.region ?? { start: 0, end: this.engine.duration });
      this.waveform.setCutMode(true, this.engine.region);
      this._updateCutInfo(this.engine.region);
    } else {
      this.engine.setRegion(null);
      this.waveform.setCutMode(false);
    }
    this._refreshControls();
  }

  _updateCutInfo(region) {
    if (!region) return;
    $('#cut-range').textContent = `${formatTime(region.start, true)} – ${formatTime(region.end, true)}`;
    $('#cut-length').textContent = formatTime(region.end - region.start, true);
  }

  previewCut() {
    const region = this.engine.region;
    if (!region) return;
    this.engine.seek(region.start);
    this.engine.play();
  }

  cropToSelection() {
    const track = this.playlist.current;
    const region = this.engine.region;
    if (!track || !region) return;
    if (region.end - region.start >= track.duration - 0.05) {
      this.toasts.show('Drag the handles to pick what to keep first');
      return;
    }
    const wasPlaying = this.engine.playing;
    track.original ??= track.buffer;
    track.buffer = sliceBuffer(track.buffer, region.start, region.end);
    this._reloadEdited(track, wasPlaying);
    this.toasts.show(`Cropped to ${formatTime(track.duration, true)}`, { type: 'success' });
  }

  restoreOriginal() {
    const track = this.playlist.current;
    if (!track?.original) return;
    const wasPlaying = this.engine.playing;
    track.buffer = track.original;
    track.original = null;
    this._reloadEdited(track, wasPlaying);
    this.toasts.show('Restored the original', { type: 'success' });
  }

  _reloadEdited(track, autoplay) {
    track.edited = Boolean(track.original);
    track.duration = track.buffer.duration;
    track.peaks = computePeaks(track.buffer);
    this.setCutMode(false);
    this.engine.load(track.buffer, { autoplay });
    this.waveform.setData(track.peaks, track.duration);
    this.view.setBadges(track);
    this._renderQueue();
    this._refreshControls();
  }

  /* ---------- export ---------- */

  exportContext() {
    const track = this.playlist.current;
    return {
      track,
      buffer: this.engine.buffer ? track?.buffer ?? null : null,
      fx: { ...this.state.fx },
      region: this.cutMode && this.engine.region ? { ...this.engine.region } : null,
    };
  }

  runExport({ format, bitDepth, bitrate, applyEffects, selectionOnly, onProgress, signal }) {
    const ctx = this.exportContext();
    if (!ctx.buffer) return Promise.reject(new Error('No track loaded'));
    return exportAudio({
      buffer: ctx.buffer,
      region: selectionOnly ? ctx.region : null,
      fx: applyEffects ? ctx.fx : null,
      format,
      bitDepth,
      bitrate,
      tags: { title: ctx.track.title, artist: ctx.track.artist },
      onProgress,
      signal,
    });
  }

  /* ---------- wiring ---------- */

  _bindEngine() {
    this.engine.on('play', () => {
      this.view.setPlaying(true);
      this._afterPlayState();
    });
    this.engine.on('pause', () => {
      this.view.setPlaying(false);
      this._afterPlayState();
    });
    this.engine.on('ended', () => {
      this.view.setPlaying(false);
      if (this.engine.loopMode === 'all' && this.playlist.tracks.length <= 1) {
        this.engine.seek(this.engine.bounds()[0]);
        this.engine.play();
        return;
      }
      this.next({ auto: true });
    });
    this.engine.on('region', (region) => this._updateCutInfo(region));
  }

  _afterPlayState() {
    this._updateStatus();
    this._updateTitle();
    this._renderQueue();
    this._updateMediaSession();
  }

  _bindUI() {
    const actions = {
      'open-files': () => $('#file-input').click(),
      'load-demo': () => this.loadDemo(),
      'open-export': () => this.exportDialog.open(),
      'open-settings': () => this.settingsPanel.open(),
      'fx-reset': () => {
        this.fxPanel.apply({ ...FX_DEFAULTS });
        this.toasts.show('Effects reset', { duration: 1600 });
      },
      'queue-clear': () => this.clearQueue(),
      'cut-preview': () => this.previewCut(),
      'cut-crop': () => this.cropToSelection(),
      'cut-restore': () => this.restoreOriginal(),
    };
    document.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button || button.disabled) return;
      actions[button.dataset.action]?.();
    });

    $('#file-input').addEventListener('change', (e) => {
      this.addFiles(e.target.files);
      e.target.value = '';
    });
    $('#btn-play').addEventListener('click', () => this.togglePlay());
    $('#btn-next').addEventListener('click', () => this.next());
    $('#btn-prev').addEventListener('click', () => this.prev());
    $('#btn-shuffle').addEventListener('click', () => this.toggleShuffle());
    $('#btn-loop').addEventListener('click', () => this.cycleLoop());
    $('#btn-mute').addEventListener('click', () => this.toggleMute());
    $('#cut-toggle').addEventListener('click', () => this.setCutMode(!this.cutMode));
    $('#scrim').addEventListener('click', () => this.settingsPanel.close());

    this.waveform.on('seek', (t) => this.engine.seek(t));
    this.waveform.on('scrub', (t) => this.engine.seek(t));
    this.waveform.on('regioninput', (region) => this._updateCutInfo(region));
    this.waveform.on('regionchange', (region) => {
      this.engine.setRegion(region);
      this.waveform.setRegion(this.engine.region);
    });
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (!this.entered || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (this.settingsPanel.overlay.isOpen || this.exportDialog.overlay.isOpen) return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return;
      const onButton = Boolean(target.closest?.('button, a'));
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const run = (fn) => {
        e.preventDefault();
        fn();
      };
      switch (key) {
        case ' ':
          if (!onButton) run(() => this.togglePlay());
          break;
        case 'ArrowRight':
          run(() => this.seekBy(e.shiftKey ? 15 : 5));
          break;
        case 'ArrowLeft':
          run(() => this.seekBy(e.shiftKey ? -15 : -5));
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          run(() => {
            const next = clamp(this.state.volume + (key === 'ArrowUp' ? 0.05 : -0.05), 0, 1);
            this.volumeSlider.setValue(next);
            this.setVolume(next);
          });
          break;
        case 'n':
          run(() => this.next());
          break;
        case 'p':
          run(() => this.prev());
          break;
        case 'l':
          run(() => this.cycleLoop());
          break;
        case 's':
          run(() => this.toggleShuffle());
          break;
        case 'm':
          run(() => this.toggleMute());
          break;
        case 'c':
          if (this.engine.buffer) run(() => this.setCutMode(!this.cutMode));
          break;
        case 'e':
          if (this.engine.buffer) run(() => this.exportDialog.open());
          break;
        case ',':
          run(() => this.settingsPanel.open());
          break;
        default:
      }
    });
  }

  _bindDrop() {
    const zone = $('#dropzone');
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      zone.classList.add('is-on');
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) zone.classList.remove('is-on');
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      zone.classList.remove('is-on');
      this.engine.unlock();
      this.addFiles(e.dataTransfer.files);
    });
  }

  _bindMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      play: () => this.engine.play(),
      pause: () => this.engine.pause(),
      nexttrack: () => this.next(),
      previoustrack: () => this.prev(),
      seekto: (d) => this.engine.seek(d.seekTime),
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        // Not every browser supports every action.
      }
    }
  }

  _updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const track = this.playlist.current;
    try {
      navigator.mediaSession.metadata =
        track && typeof MediaMetadata === 'function'
          ? new MediaMetadata({ title: track.title, artist: track.artist || 'temu studio', album: track.album || '', artwork: track.cover ? [{ src: track.cover }] : [] })
          : null;
      navigator.mediaSession.playbackState = this.engine.playing ? 'playing' : track ? 'paused' : 'none';
    } catch {
      // Media Session is a nice-to-have.
    }
  }

  _onSettings(patch, v) {
    applyTheme(v);
    this.sky.configure(v);
    if ('accent' in patch || 'accent2' in patch) {
      this.waveform.setColors(v.accent, v.accent2);
      this.sparkles.setColors(v.accent, v.accent2);
    }
    if ('refraction' in patch) this.glass.setEnabled(v.refraction);
    if ('glassBlur' in patch) this.glass.setBlur(v.glassBlur);
    if ('radius' in patch) this.glass.setRadius(v.radius);
    if ('tilt' in patch || 'sparkles' in patch || 'reduceMotion' in patch) this._applyMotion(v);
  }

  _applyMotion(v) {
    this.tilt.setEnabled(v.tilt && !v.reduceMotion);
    this.sparkles.setEnabled(v.sparkles && !v.reduceMotion);
  }

  _refreshControls() {
    const hasTrack = Boolean(this.engine.buffer);
    const count = this.playlist.tracks.length;
    $('#btn-play').disabled = !hasTrack && !count;
    $('#btn-next').disabled = !count;
    $('#btn-prev').disabled = !count;
    $('#cut-toggle').disabled = !hasTrack;
    $('#btn-export').disabled = !hasTrack;
    $('#btn-restore').disabled = !this.playlist.current?.original;
  }

  _renderQueue() {
    this.queueView.render(this.playlist.tracks, this.playlist.index, this.engine.playing);
  }

  _updateStatus() {
    let status = 'ready when you are';
    if (this.loading) status = 'loading…';
    else if (this.engine.buffer) status = this.engine.playing ? 'now playing' : 'paused';
    if (this.engine.buffer && this.state.fx.laptop) status += ' · laptop mix';
    this.view.setStatus(status);
  }

  _updateTitle() {
    const track = this.playlist.current;
    document.title = track ? `${this.engine.playing ? '▶ ' : ''}${track.title} · temu studio` : 'temu studio';
  }

  _frame(dt) {
    const engine = this.engine;
    const time = engine.currentTime;
    this.waveform.setTime(time);
    this.view.setTime(time, engine.duration);
    this.view.frame(dt, engine.playing, engine.fx.rate, engine.getEnergy(), this.entered);
  }
}
