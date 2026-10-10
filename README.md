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
