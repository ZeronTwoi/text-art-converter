# Text Art Studio

Turns pictures, GIFs and videos into text art (braille, ASCII, blocks, emoji …) and back into
pictures, animations or chat-ready text. Everything runs on your own computer — nothing is uploaded.

## Just want to try it?

**Windows** — download **`text-art-studio-…-setup.exe`** from the
[latest release](https://github.com/ZeronTwoi/text-art-converter/releases/latest) and
**double-click it**. That's all: it installs and opens like any other program.
Prefer no installation? Take **`…-portable.exe`** instead — one file, double-click, it runs.

> Windows may show *"Windows protected your PC"* because the download is not code-signed.
> Click **More info → Run anyway**. If you want to be sure, compare the file with
> `SHA256SUMS.txt` from the same release.

**Linux** — download the **`.AppImage`** from the
[latest release](https://github.com/ZeronTwoi/text-art-converter/releases/latest), make it
executable (right-click → Properties → *Allow executing file as program*, or `chmod +x`), and
double-click it. A `.deb` package is there too.

**Any browser, no download manager, no install** — the whole app is one file:
`web/index.html`. Get the source (green **Code** button → *Download ZIP*), unpack it, and open
`web/index.html` in Chrome, Edge or Firefox. It works offline.

## What it does

- Braille, ASCII, blocks, halftone, emoji and many more looks, each tuned per picture — plus one
  slider to re-balance any look
- GIFs and videos become animated text art; save as GIF, MP4, WEBM (with the original sound), APNG,
  text, SVG, ZIP of frames, and more — with a "fit a size limit" helper for chat-app upload caps
- Copy straight into Discord, WhatsApp, X and other apps, with per-app checks and one-click fixes
- Crop, masks, captions, a picture on top (logo / watermark, as characters or sharp), colour
  palettes, batch conversion, projects, printing — in 7 interface languages
- Completely offline: nothing ever leaves your computer

## Free — also for commercial use

[MIT license](LICENSE): use it, change it, sell things made with it — no strings attached.
If you mention Text Art Studio when you use it somewhere, that is appreciated, never required.

This project was built with the help of an AI coding assistant (Anthropic's Claude).

## For developers

The page is built from `web/src/` into the single file `web/index.html`:

```
cd web
node build.mjs          # writes index.html (the app), test.html (app + tests) and sw.js
node test.mjs           # self-test, bit-exact regression check, feature checks, video checks
```

`node test.mjs` needs Node 22+ and Chrome or Edge (or `CHROME=<path>`); exit code 1 means a failure.
Single suites: `node test.mjs selftest`, `equiv`, `uitest`, `pwa`, `video`.

| Path | What it is |
| --- | --- |
| `web/src/page.html`, `web/src/styles.css` | markup and styles |
| `web/src/js/NN-*.js` | the script, joined in name order into one inline script |
| `web/src/i18n/<lang>.json` | the interface languages |
| `web/src/wasm/` | the SIMD edge detector |
| `desktop/` | the Electron shell around the same page |

Desktop app (Windows and Linux):

```
cd desktop
npm install
npm start               # run it (on Windows, double-clicking desktop\dev.cmd does all of this)
node smoke.mjs          # drive the real shell and check start, file open, camera, storage, restart
npm run dist:win        # Windows installer + portable .exe → desktop/dist/
```

Linux packages are built by CI: the `desktop` workflow in `.github/workflows/` builds both
platforms, and pushing a `desktop-v*` tag publishes a Release with the files and their checksums.
