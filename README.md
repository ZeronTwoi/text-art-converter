# ImageTo_Text_TextImage

## Text Art Studio (`web/`)

Turns pictures, GIFs and videos into text art (braille, ASCII, blocks, emoji…) and back into pictures,
animations or chat-ready text. Everything runs in the browser; nothing is uploaded.

**To use it:** open `web/index.html` in Chrome, Edge or Firefox. That single file is the whole app and
works offline.

Served over https (or `localhost`) it can also be installed as an app with an offline cache
(`manifest.webmanifest`, `sw.js`, icons).

### Changing it

The page is built from `web/src/`:

| Path | What it is |
| --- | --- |
| `src/page.html`, `src/styles.css` | markup and styles |
| `src/js/NN-*.js` | the script, joined in name order into one inline script |
| `src/wasm/` | the SIMD edge detector |
| `src/sw.js` | the offline cache of the installed app |

```
cd web
node build.mjs          # writes index.html (the app), test.html (app + tests) and sw.js
node test.mjs           # self-test, bit-exact regression check, feature checks, installed-app check
```

`node test.mjs` needs Node 22+ and Chrome or Edge (or `CHROME=<path>`). It exits with code 1 if
anything fails. Single suites: `node test.mjs selftest`, `equiv`, `uitest`, `pwa`, `video`.
To check video in your own browser: open `web/test.html#videotest` and press Start. (`test.html` is the app plus its tests; `index.html` is the app alone.)

## Desktop app (`desktop/`)

A small Electron shell around the same `web/index.html` (the page is unchanged and keeps working
in a browser). It serves the page from a stable `app://` origin so settings, projects and sessions
persist, opens files passed on the command line or by double-click, lets the camera through, and
opens outside links in the system browser.

```
cd desktop
npm install
npm start               # run it (electron .)
node smoke.mjs          # run it headlessly and check start, file open, camera, storage, restart
node smoke.mjs selftest # the page's own test suites inside the shell (also: uitest, videotest)
npm run dist:win        # Windows: NSIS installer + portable .exe → desktop/dist/
npm run dist:linux      # Linux: AppImage + .deb (build on Linux; see the workflow below)
```

The GitHub Actions workflow `.github/workflows/desktop.yml` builds Windows and Linux packages
(run it from the Actions tab, or push a `desktop-v*` tag). Builds are unsigned.
