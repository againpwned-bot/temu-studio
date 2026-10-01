/** Minimal ID3v2.3 / v2.4 reader for title, artist, album and cover art. Never throws. */

const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function deunsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[n++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

function decoderFor(encoding, bytes) {
  if (encoding === 0) return new TextDecoder('iso-8859-1');
  if (encoding === 1) return new TextDecoder(bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-16le');
  if (encoding === 2) return new TextDecoder('utf-16be');
  return new TextDecoder('utf-8');
}

function decodeText(body) {
  if (!body.length) return '';
  const encoding = body[0];
  const data = body.subarray(1);
  return decoderFor(encoding, data)
    .decode(data)
    .replace(/^﻿/, '')
    .split('\u0000')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

function findTerminator(bytes, from, wide) {
  if (!wide) {
    const i = bytes.indexOf(0, from);
    return i === -1 ? bytes.length : i;
  }
  for (let i = from; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  return bytes.length;
}

function decodePicture(body) {
  const encoding = body[0];
  const mimeEnd = findTerminator(body, 1, false);
  let mime = new TextDecoder('iso-8859-1').decode(body.subarray(1, mimeEnd)).toLowerCase();
  const wide = encoding === 1 || encoding === 2;
  const descStart = mimeEnd + 2;
  const descEnd = findTerminator(body, descStart, wide);
  const dataStart = descEnd + (wide ? 2 : 1);
  if (dataStart >= body.length) return null;
  if (!mime || mime === 'jpg' || mime === 'image/jpg') mime = 'image/jpeg';
  if (mime === 'png') mime = 'image/png';
  if (!mime.startsWith('image/')) return null;
  return new Blob([body.slice(dataStart)], { type: mime });
}

export async function readTags(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
    const version = head[3];
    if (version < 3 || version > 4) return null;
    const flags = head[5];
    const size = synchsafe(head, 6);
    let bytes = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
    if (flags & 0x80 && version === 3) bytes = deunsync(bytes);

    let pos = 0;
    if (flags & 0x40) pos = version === 4 ? synchsafe(bytes, 0) : u32(bytes, 0) + 4;

    const tags = {};
    while (pos + 10 <= bytes.length) {
      const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const frameSize = version === 4 ? synchsafe(bytes, pos + 4) : u32(bytes, pos + 4);
      const formatFlags = bytes[pos + 9];
      if (frameSize <= 0 || pos + 10 + frameSize > bytes.length) break;
      let body = bytes.subarray(pos + 10, pos + 10 + frameSize);
      pos += 10 + frameSize;

      if (version === 4) {
        if (formatFlags & 0x0c) continue; // compressed or encrypted
        if (formatFlags & 0x01) body = body.subarray(4);
        if (formatFlags & 0x02) body = deunsync(body);
      } else if (formatFlags & 0xc0) continue;

      if (id === 'TIT2') tags.title = decodeText(body);
      else if (id === 'TPE1') tags.artist = decodeText(body);
      else if (id === 'TALB') tags.album = decodeText(body);
      else if (id === 'APIC' && !tags.picture) tags.picture = decodePicture(body);
    }
    return tags;
  } catch {
    return null;
  }
}

export function parseFilename(name) {
  const base = name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/_/g, ' ')
    .trim();
  const match = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return match ? { artist: match[1].trim(), title: match[2].trim() } : { artist: '', title: base || 'Untitled' };
}
