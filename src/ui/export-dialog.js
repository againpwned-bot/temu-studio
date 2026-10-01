import { $, el } from '../utils/dom.js';
import { formatBytes, formatTime } from '../utils/format.js';
import { downloadBlob, safeFilename } from '../utils/download.js';
import { Overlay } from './overlay.js';
import { Segmented } from './segmented.js';
import { bindSwitch } from './switch.js';

const WAV_DEPTHS = [
  { value: '16', label: '16-bit' },
  { value: '24', label: '24-bit' },
  { value: '32', label: '32-bit float' },
];
const MP3_RATES = [
  { value: '128', label: '128k' },
  { value: '192', label: '192k' },
  { value: '256', label: '256k' },
  { value: '320', label: '320k' },
];

function segmented(name, options, value) {
  return el('div', { class: 'seg seg--choice', role: 'group', 'aria-label': name }, [
    el('span', { class: 'seg-indicator', 'aria-hidden': 'true' }),
    ...options.map((o) => el('button', { type: 'button', dataset: { value: o.value }, 'aria-pressed': String(o.value === value), text: o.label })),
  ]);
}

function optionRow(title, description, switchId) {
  const button = el('button', { class: 'switch', type: 'button', role: 'switch', id: switchId, 'aria-checked': 'false', 'aria-labelledby': `${switchId}-label` });
  const row = el('div', { class: 'opt-row' }, [
    el('span', { class: 'opt-text' }, [el('strong', { id: `${switchId}-label`, text: title }), el('small', { text: description })]),
    button,
  ]);
  return { row, button };
}

/** Builds a descriptive suffix like "(slowed + reverb)" from the active effects. */
function effectSuffix(fx, cut) {
  const parts = [];
  if (fx.rate < 0.995 && fx.reverb > 0.12) parts.push('slowed + reverb');
  else if (fx.rate < 0.995) parts.push('slowed');
  else if (fx.rate > 1.005) parts.push(fx.rate >= 1.2 ? 'nightcore' : 'sped up');
  else if (fx.reverb > 0.12) parts.push('reverb');
  if (fx.bass >= 3) parts.push('bass boosted');
  if (fx.laptop) parts.push('laptop mix');
  if (cut) parts.push('cut');
  return parts.length ? ` (${parts.join(', ')})` : '';
}

export class ExportDialog {
  constructor(root, { getContext, run, toasts }) {
    this.getContext = getContext;
    this.run = run;
    this.toasts = toasts;
    this.format = 'mp3';
    this.depth = '16';
    this.bitrate = '320';
    this.busy = false;
    this.abort = null;
    this.overlay = new Overlay(root, { onClose: () => this.abort?.abort() });

    const formatSeg = segmented('Format', [{ value: 'mp3', label: 'MP3' }, { value: 'wav', label: 'WAV' }], this.format);
    this.wavSeg = segmented('WAV bit depth', WAV_DEPTHS, this.depth);
    this.mp3Seg = segmented('MP3 bitrate', MP3_RATES, this.bitrate);
    const effects = optionRow('Apply effects', 'Speed, bass, reverb and laptop mode', 'export-fx');
    const selection = optionRow('Only the cut selection', 'Turn on Cut mode to pick a range', 'export-sel');
    this.selectionRow = selection.row;
    this.nameInput = el('input', { class: 'text-input', type: 'text', id: 'export-name', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'File name' });
    this.ext = el('span', { class: 'input-ext', text: '.mp3' });
    this.summary = el('p', { class: 'export-summary' });
    this.progressBar = el('span', { class: 'progress-bar' });
    this.progressLabel = el('span', { class: 'progress-label', text: 'Rendering…' });
    this.progressValue = el('span', { class: 'progress-value', text: '0%' });
    this.progress = el('div', { class: 'collapse export-progress' }, [
      el('div', { class: 'collapse-inner' }, [
        el('div', { class: 'collapse-body' }, [
          el('div', { class: 'progress-head' }, [this.progressLabel, this.progressValue]),
          el('div', { class: 'progress' }, [this.progressBar]),
        ]),
      ]),
    ]);
    this.cancelButton = el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel' });
    this.exportButton = el('button', { class: 'btn btn-accent', type: 'button' }, [el('span', { text: 'Export' })]);

    $('#export-body', root).append(
      el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Format' }), formatSeg]),
      el('div', { class: 'field' }, [
        el('span', { class: 'field-label', text: 'Quality' }),
        el('div', { class: 'quality-stack' }, [this.mp3Seg, this.wavSeg]),
      ]),
      el('div', { class: 'field' }, [effects.row, selection.row]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', for: 'export-name', text: 'File name' }),
        el('div', { class: 'input-wrap' }, [this.nameInput, this.ext]),
      ]),
      this.summary,
      this.progress,
      el('div', { class: 'modal-actions' }, [this.cancelButton, this.exportButton]),
    );

    this.formatControl = new Segmented(formatSeg, {
      role: 'radio',
      onChange: (v) => {
        this.format = v;
        this._syncFormat();
      },
    });
    this.wavControl = new Segmented(this.wavSeg, {
      role: 'radio',
      onChange: (v) => {
        this.depth = v;
        this._updateSummary();
      },
    });
    this.mp3Control = new Segmented(this.mp3Seg, {
      role: 'radio',
      onChange: (v) => {
        this.bitrate = v;
        this._updateSummary();
      },
    });
    this.effects = bindSwitch(effects.button, { checked: true, onChange: () => this._refreshName() });
    this.selection = bindSwitch(selection.button, { checked: false, onChange: () => this._refreshName() });
    this.selectionButton = selection.button;

    this.cancelButton.addEventListener('click', () => (this.busy ? this.abort?.abort() : this.overlay.close()));
    this.exportButton.addEventListener('click', () => this._export());
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._export();
    });
    this._syncFormat();
  }

  open() {
    const ctx = this.getContext();
    if (!ctx.buffer) return;
    const hasRegion = Boolean(ctx.region);
    this.selectionButton.disabled = !hasRegion;
    this.selection.set(hasRegion);
    this.selectionRow.classList.toggle('is-disabled', !hasRegion);
    this._refreshName();
    this._setBusy(false);
    this.overlay.open();
  }

  _refreshName() {
    const { track, fx, region } = this.getContext();
    if (!track) return;
    const base = `${track.artist ? `${track.artist} - ` : ''}${track.title}`;
    const useFx = this.effects.checked;
    const cut = this.selection.checked && Boolean(region);
    this.nameInput.value = safeFilename(base + effectSuffix(useFx ? fx : { rate: 1, bass: 0, reverb: 0, laptop: false }, cut));
    this._updateSummary();
  }

  _syncFormat() {
    const mp3 = this.format === 'mp3';
    this.mp3Seg.classList.toggle('is-hidden', !mp3);
    this.wavSeg.classList.toggle('is-hidden', mp3);
    this.mp3Seg.inert = !mp3;
    this.wavSeg.inert = mp3;
    this.ext.textContent = mp3 ? '.mp3' : '.wav';
    requestAnimationFrame(() => {
      this.mp3Control.select(this.bitrate, { emit: false, animate: false });
      this.wavControl.select(this.depth, { emit: false, animate: false });
    });
    this._updateSummary();
  }

  _estimate() {
    const { buffer, fx, region } = this.getContext();
    if (!buffer) return null;
    const useRegion = this.selection.checked && region;
    const source = useRegion ? region.end - region.start : buffer.duration;
    const rate = this.effects.checked ? fx.rate : 1;
    const seconds = source / rate + (this.effects.checked && fx.reverb > 0 ? Math.min(fx.decay, 2) : 0);
    const channels = this.effects.checked ? 2 : Math.min(2, buffer.numberOfChannels);
    const bytes =
      this.format === 'mp3'
        ? (Number(this.bitrate) * 1000 * seconds) / 8
        : seconds * Math.min(buffer.sampleRate, 192000) * channels * (Number(this.depth) / 8);
    return { seconds, bytes };
  }

  _updateSummary() {
    const est = this._estimate();
    if (!est) return;
    const quality = this.format === 'mp3' ? `${this.bitrate} kbps` : this.depth === '32' ? '32-bit float' : `${this.depth}-bit PCM`;
    this.summary.replaceChildren(
      el('span', { text: `≈ ${formatTime(est.seconds)}` }),
      el('span', { class: 'dot' }),
      el('span', { text: `~${formatBytes(est.bytes)}` }),
      el('span', { class: 'dot' }),
      el('span', { text: quality }),
    );
  }

  _setBusy(busy) {
    this.busy = busy;
    this.progress.classList.toggle('is-open', busy);
    this.exportButton.disabled = busy;
    this.exportButton.firstElementChild.textContent = busy ? 'Exporting…' : 'Export';
    this.cancelButton.textContent = busy ? 'Stop' : 'Cancel';
    if (!busy) this._setProgress('Rendering…', 0);
  }

  _setProgress(label, value) {
    this.progressLabel.textContent = label;
    this.progressValue.textContent = `${Math.round(value * 100)}%`;
    this.progressBar.style.setProperty('--v', value.toFixed(4));
  }

  async _export() {
    if (this.busy) return;
    const ext = this.format;
    const name = safeFilename(this.nameInput.value);
    this.abort = new AbortController();
    this._setBusy(true);
    try {
      const blob = await this.run({
        format: this.format,
        bitDepth: Number(this.depth),
        bitrate: Number(this.bitrate),
        applyEffects: this.effects.checked,
        selectionOnly: this.selection.checked,
        signal: this.abort.signal,
        onProgress: (stage, p) => {
          if (stage === 'render') this._setProgress('Rendering effects…', p * 0.55);
          else this._setProgress(ext === 'mp3' ? 'Encoding MP3…' : 'Writing WAV…', 0.55 + p * 0.45);
        },
      });
      this._setProgress('Done', 1);
      downloadBlob(blob, `${name}.${ext}`);
      this.toasts.show(`Exported ${name}.${ext} · ${formatBytes(blob.size)}`, { type: 'success', duration: 3600 });
      this.abort = null;
      setTimeout(() => this.overlay.close(), 350);
    } catch (error) {
      if (error?.name === 'AbortError' || /cancel/i.test(error?.message ?? '')) {
        this.toasts.show('Export cancelled');
      } else {
        console.error(error);
        this.toasts.show(`Export failed: ${error?.message ?? error}`, { type: 'error', duration: 4200 });
      }
    } finally {
      this.abort = null;
      setTimeout(() => this._setBusy(false), 400);
    }
  }
}
