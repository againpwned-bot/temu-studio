# temu studio

A liquid-glass audio player that runs in the browser. Drop in a song, bend it with effects, cut it, and export it as WAV or MP3.

## Run it

You need [Node.js](https://nodejs.org) 20.19+ (the LTS installer is fine).

**Windows:** double-click `start.bat`.

**Any OS:**

```bash
npm install
npm run dev
```

Vite opens the app in your browser at http://localhost:5173. Use Chrome or Edge for the full liquid refraction; other browsers get the frosted-glass version.

`npm run build` produces a static site in `dist/` that you can host anywhere.

## Features

- **Player**: play/pause, next/previous, a queue with drag-and-drop or file picker (mp3, wav, flac, ogg, m4a…), shuffle, and three loop modes (off / queue / one track, gapless)
- **Waveform**: click or drag anywhere to seek, with hover time preview
- **Speed**: 0.5×–2× where pitch follows speed (tape style). Presets glide smoothly to their values.
- **Bass boost** (up to +18 dB, with automatic headroom and a limiter so it never clips)
- **Reverb**: wet mix plus room size, using a generated stereo impulse response
- **Laptop Speakers mode**: cuts sub-bass that small speakers can't play, adds harmonics so you still *hear* the bass, boosts clarity, and compresses for loudness
- **Cut**: drag the handles to select a range, preview it, crop to it, or restore the original
- **Export**: WAV (16/24/32-bit float) or MP3 (128–320 kbps), with or without effects, whole track or just the selection. Encoding runs in a Web Worker so the UI stays smooth.
- **Settings**: 6 themes; accent/text/glass colors; sky and **cloud color**, cloud density and drift; 7 fonts; text size; blur, tint, corner radius; liquid refraction; intro, tilt, sparkles and reduce-motion toggles. Everything is saved automatically.
- **Sky**: procedurally generated in a worker: a gradient sky with three parallax cloud banks filling the bottom quarter, recolored live
- **Feel**: guns.lol style click-to-enter intro, real spring physics for every animation, a 3D card tilt, cursor sparkles, a bass-reactive glow, and a spinning vinyl
- **Demo track**: a lo-fi loop synthesized in the browser, so you can try everything without a file

If a device can't keep up with the refraction effect, the app switches to lite glass once on its own and tells you. You can turn refraction back on in Settings → Glass.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← → | Seek 5 s (Shift: 15 s) |
| ↑ ↓ | Volume |
| N / P | Next / previous |
| L | Cycle loop mode |
| S | Shuffle |
| M | Mute |
| C | Cut mode |
| E | Export |
| , | Settings |

## Project layout

```
src/
  main.js              entry: fonts, styles, boot
  app.js               wires engine, playlist, UI and settings together
  core/
    audio-engine.js    buffer playback, seeking, speed, loop, cut region
    effects.js         bass / reverb / laptop-speaker chain (shared by playback and export)
    impulse.js         generated reverb impulse responses
    exporter.js        offline render + progress
    encoder-client.js  talks to the encoder worker
    playlist.js        queue, shuffle order
    buffer-utils.js    waveform peaks, slicing
    id3.js             title/artist/cover from MP3 tags
    demo-track.js      synthesized demo song
    settings.js        themes, defaults, persistence
  ui/                  waveform, sliders, tabs, sky, liquid glass, panels, intro…
  workers/             MP3/WAV encoder, cloud generator
  styles/              tokens, glass, controls, player, overlays
```
