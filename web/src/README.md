# How Text Art Studio is built

A guide for changing the code. The app is one offline page. `node build.mjs` joins these sources into:

- `index.html`: the app.
- `test.html`: the app plus its tests.
- `sw.js`: the offline cache, used only when the app is installed.

There are no libraries and no bundler. The script is one classic `<script>`, so every file shares one global scope.

## The flow of a picture

```
file / paste / webcam / demo ──► source (08)            image · anim (frames) · video · webcam · text
            │                         every decoded picture becomes a canvas-made bitmap (rasterBitmap):
            │                         the same pixels always resample the same way
            ▼
settings S (01) ──► convertRaw (03) ──► result {cols, rows, cp, fg, bgc, bits, val}   (cached, never changed)
            │            │  resample on this thread (02 drawTransformed), the rest may run on a worker (07)
            │            ▼
            └──► withOverlay (15)  captions + hand edits ──► result with ov flags (a copy)
                         ▼
                 renderResult / resultText / resultANSI / resultSVG (04) ──► preview, every export (09, 34)
```

- **The two convert functions:** `convert()` is `withOverlay(convertRaw())`. Use `convertRaw` only for things that must not show captions or edits, such as look thumbnails.
- **Per-frame settings:** for each frame of an animation or video, `settingsAt(t)` (31) is `S` plus the ramps. Exports get them from `frameSettings(f)`.

## Files (`src/js`, joined in name order)

| Area | Files |
| --- | --- |
| Settings, presets, helpers | 01 |
| Engine: resampling, dithering, outlines, conversion, emoji, retro palettes, pixel font | 02, 03, 22, 32 |
| Drawing and text formats | 04 |
| Decoders and encoders: GIF, APNG, WEBP, ZIP, workers | 05, 06, 07, 19 |
| Sources, playback, the render loop (`tick`, `showResult`) | 08 |
| Exports, sharing to chat apps, batch | 09, 12, 27, 34, 35 |
| UI: controls, tabs, looks, folds, filmstrip | 10, 11 |
| Tools on the picture (`STAGE_TOOLS`): crop box, wipe, mask, editing, hover, touch | 17, 18, 21, 25, 30 |
| Features | 15 overlay · 16 ANSI import · 23 effects · 24 guides · 28 session · 29 versions · 31 ramps · 33 palettes |
| Reaching things: accessibility, find a tool, what's new | 26, 37 |
| Start | 99 (calls `initUI()`) |

`src/tests/` holds the self-test, the bit-exact regression check (`EQUIV_BASELINE`), the feature checks, the video check and the diagnostics. They are only in `test.html`.

## Rules that keep it working

1. **Code that runs on the workers must be function declarations.** `engineSource()` (07) copies functions by their source text. Arrow functions go in its `arrows` list, data in `data`. A wrong entry now throws, and the regression check fails if the workers cannot start.
2. **Results are never changed in place.** The caches (`resultCache`) and the worker copies share them. Make a copy, as `applyOverlay` does.
3. **Settings live in `DEFAULTS` (01).** A key that does not change the conversion goes in `RENDER_ONLY_KEYS` (03), so caches keep working. Picture-specific keys go in `LOOK_SKIP` (11).
4. **Unique names.** All files share one scope, and all CSS shares one stylesheet. Check that a new global name or class name is not used yet. The `.empty` start screen once turned a toolbar into a full-page cover. The type check finds duplicate names; the layout check finds full-page covers.
5. **New features need a way to be found.** Add an entry to `toolList()` (37). For a bigger feature, add an item to `WHATS_NEW` too. Secondary controls go in a fold: `<details class="group fold" data-fold="…">`.
6. **Changed engine results need a deliberate decision.** The regression check compares hashes. Only paste the new baseline it prints if the change was intended. New features get new groups; existing hashes never move.

## Checking

```
npm install          # once: the type checker (and wabt for the WebAssembly source)
node build.mjs       # index.html, test.html, sw.js
node test.mjs        # build check, type check, self-test, regression, feature checks, installed app, video
```

`node build.mjs --types` runs the type check alone. It fails on real mistakes: unknown or misspelled names, double declarations, use before declaration, assigning to a constant or function, wrong argument counts and syntax errors. Its other "hints" are TypeScript being stricter than this plain JavaScript.
