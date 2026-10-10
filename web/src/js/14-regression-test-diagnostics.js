/* =====================================================================
   Regression test (open index.html#equiv): hashes of the conversion engine, the text formats and the encoders
   on synthetic pixels. No canvas resampling and no fonts are involved, so the hashes are the same on every
   machine and browser. Each group must match EQUIV_BASELINE; after an intended change of results, paste the
   new baseline the page prints into EQUIV_BASELINE.
   ===================================================================== */
const EQUIV_BASELINE = {"braille/mono":"80ed5cd4", "braille/color":"90b47959", "braille/gray":"aa9af11d", "braille/gradient":"26cc3fa7", "braille/discord":"b9fb4d13", "braille/ansi16":"59261307", "braille/ansi256":"2a8a28cf", "ascii/mono":"d8131a4", "ascii/color":"c375ad97", "ascii/gray":"9cd65da6", "ascii/gradient":"307094ea", "ascii/discord":"10624337", "ascii/ansi16":"a25c65", "ascii/ansi256":"edf5d1bc", "edge/mono":"5cff6fc9", "edge/color":"30aaf650", "edge/gray":"81fb68f7", "edge/gradient":"675226b2", "edge/discord":"7ef20048", "edge/ansi16":"c77be3d9", "edge/ansi256":"884760d6", "half/mono":"2c295a3a", "half/color":"fce77fa", "half/gray":"2c00f749", "half/gradient":"963107ed", "half/discord":"6d408fc3", "half/ansi16":"354fc0ea", "half/ansi256":"d106164d", "quad/mono":"15451cf7", "quad/color":"27c636c5", "quad/gray":"2066e61e", "quad/gradient":"33be9f30", "quad/discord":"1d233686", "quad/ansi16":"666999b8", "quad/ansi256":"68f63470", "halftone/mono":"5591b69b", "halftone/color":"8102d88d", "halftone/gray":"e8de1014", "halftone/gradient":"c03a83d4", "halftone/discord":"c5a4d9fd", "halftone/ansi16":"ad76ceec", "halftone/ansi256":"983285a9", "word/mono":"52f4e5e0", "word/color":"165c8a2c", "word/gray":"8707ae73", "word/gradient":"f9723950", "word/discord":"82365a1f", "word/ansi16":"91ad0ea6", "word/ansi256":"90b71004", "share":"d017e1ab", "gif":"51bbf52e", "crc":"8e0979c"};
/* A test scene (sky gradient, a sun, a dark box, a thin diagonal, noise, a half transparent band) at any size. */
function synthPixels(W, H, seed) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H, o = (y * W + x) * 4;
    let r = 30 + 200 * v, g = 60 + 120 * u, b = 200 - 150 * v;
    const du = u - 0.68, dv = v - 0.35;
    if (du * du + dv * dv < 0.03) { r = 255; g = 220; b = 120; }
    if (u > 0.12 && u < 0.42 && v > 0.55 && v < 0.85) { r = 25; g = 20; b = 40; }
    if (Math.abs(u - (1 - v)) < 0.006) { r = g = b = 250; }
    const n = (hashNoise(x * 7 + seed, y * 13 + seed) - 0.5) * 36;
    d[o] = r + n; d[o + 1] = g + n; d[o + 2] = b + n; d[o + 3] = u < 0.06 ? 120 : 255;
  }
  return d;
}
function equivCases() {
  const modes = ['braille', 'ascii', 'edge', 'half', 'quad', 'halftone', 'word'];   // 'glyph' and sortRamp measure fonts
  const colours = [{ colorMode: 'mono' }, { colorMode: 'color' }, { colorMode: 'gray' }, { colorMode: 'gradient' }, { colorMode: 'app', appPalette: 'discord' }, { colorMode: 'app', appPalette: 'ansi16' }, { colorMode: 'app', appPalette: 'ansi256' }];
  const variants = [{}, { dither: 'atkinson' }, { dither: 'bayer8' }, { dither: 'noise' }, { dither: 'none' }, { outline: 0 }, { outline: 0.8, outlineWidth: 2 }, { outline: 1, outlineWidth: 3 },
    { bgFade: 0.6 }, { localContrast: 0.5, sharpen: 1 }, { edge: 0.5, autoLevels: true, invert: true }, { gamma: 1.6, saturation: 1.4, contrast: 0.3, brightness: -0.1 },
    { bgMode: 'cell' }, { charset: 'detailed', outlineDir: false }, { fill: 0 }, { threshold: 0.3, brailleBlank: 'space' }, { wordFillAll: true, fg: '#101010', bg: '#f0f0f0' }, { rotate: 90, cropL: 10, charAspect: 1.6 }];
  const out = [];
  for (const mode of modes) for (const c of colours) for (let vi = 0; vi < variants.length; vi++) for (const cols of [23, 64])
    out.push({ group: mode + '/' + (c.appPalette || c.colorMode), name: `${mode}/${c.appPalette || c.colorMode}/v${vi}/${cols}`, St: Object.assign({}, DEFAULTS, { mode, cols }, c, variants[vi]) });
  return out;
}
function equivInputs(St, sw, sh) {
  const { W, H, sx } = gridFor(sw, sh, St), seed = St.cols;
  if (!(outlineAmount(St) > 0)) return { sample: synthPixels(W, H, seed), hi: null };
  const f = hiFactor(W, H, sx);
  return { sample: synthPixels(W, H, seed), hi: synthPixels(W * f, H * f, seed + 1) };
}
async function equivTest() {
  const out = $('#selftest'); out.hidden = false;
  const log = [], say = l => { log.push(l); out.textContent = log.join('\n'); };
  const fnvBytes = (h, a) => { if (!a) return h; const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619); return h; };
  const fnvStr = (h, s) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h; };
  const groups = {}, add = (g, h) => { groups[g] = Math.imul((groups[g] || 2166136261) ^ (h >>> 0), 16777619); };
  const saved = Object.assign({}, S), sw = 800, sh = 500, t0 = performance.now();
  const cases = equivCases(), viaWorker = [];
  for (let k = 0; k < cases.length; k++) {
    const { group, St } = cases[k];
    Object.assign(S, St);   // the ANSI writer reads the palette from the settings
    const pre = equivInputs(St, sw, sh), r = convertCore(null, sw, sh, St, null, pre);
    let h = 2166136261;
    for (const a of [r.cp, r.fg, r.bgc, r.bits, r.val]) h = fnvBytes(h, a);
    h = fnvStr(h, `${r.cols}x${r.rows}${r.uniform}`);
    h = fnvStr(h, resultText(r)); h = fnvStr(h, resultANSI(r)); h = fnvStr(h, resultHTMLInner(r)); h = fnvStr(h, resultSVG(r, St));
    add(group, h);
    if (k % 7 === 0) viaWorker.push([k, h, pre]);
    if (k % 50 === 0) { out.textContent = log.concat(`converting ${k} / ${cases.length}…`).join('\n'); await nextTick(); }
  }
  Object.assign(S, saved);
  // shares (platform text, splitting, Discord colours)
  { const St = Object.assign({}, DEFAULTS, { mode: 'braille', colorMode: 'color', cols: 90 }), r = convertCore(null, sw, sh, St, null, equivInputs(St, sw, sh));
    for (const pk of Object.keys(PLATFORMS)) for (const split of [false, true]) { S.shareSplit = split; add('share', fnvStr(fnvStr(2166136261, shareParts(r, PLATFORMS[pk], true).join('\u0001')), platformText(r, PLATFORMS[pk], false))); }
    S.shareSplit = saved.shareSplit; }
  // encoders
  for (const [w, h, colors, transparent] of [[97, 61, 256, false], [64, 48, 16, true], [300, 7, 2, false], [1, 1, 4, false]]) {
    const px = synthPixels(w, h, w); if (transparent) for (let i = 3; i < px.length; i += 4 * 5) px[i] = 0;
    add('gif', fnvBytes(2166136261, gifFrameBytes(px, colors, transparent, 7, transparent ? 2 : 1, w, h)));
  }
  add('crc', crc32(synthPixels(50, 50, 3)));
  // the same conversions on a worker must give the same results
  let workerNote = 'workers unavailable, skipped';
  if (Pool.size()) {
    let bad = 0;
    await Promise.all(viaWorker.map(async ([k, h, pre]) => {
      const { St } = cases[k], r = await Pool.run('convertPre', { pre, sw, sh, St });
      let x = 2166136261; for (const a of [r.cp, r.fg, r.bgc, r.bits, r.val]) x = fnvBytes(x, a);
      let y = 2166136261; const m = convertCore(null, sw, sh, St, null, pre); for (const a of [m.cp, m.fg, m.bgc, m.bits, m.val]) y = fnvBytes(y, a);
      if (x !== y) { bad++; say(`FAIL worker differs: ${cases[k].name}`); }
    }));
    workerNote = bad ? `${bad} of ${viaWorker.length} differ` : `${viaWorker.length} cases identical`;
  }
  const now = Object.fromEntries(Object.entries(groups).map(([g, h]) => [g, (h >>> 0).toString(16)]));
  const keys = Object.keys(now), baseKeys = Object.keys(EQUIV_BASELINE);
  let fails = 0;
  for (const g of keys) {
    if (!(g in EQUIV_BASELINE)) { say(`NEW  ${g} ${now[g]}`); fails++; }
    else if (EQUIV_BASELINE[g] !== now[g]) { say(`FAIL ${g}: expected ${EQUIV_BASELINE[g]}, got ${now[g]}`); fails++; }
  }
  for (const g of baseKeys) if (!(g in now)) { say(`FAIL ${g}: no longer tested`); fails++; }
  say(`${fails ? 'FAIL' : 'PASS'} ${keys.length - fails} of ${keys.length} groups match (${cases.length} conversions, ${(performance.now() - t0).toFixed(0)} ms); worker check: ${workerNote}`);
  if (fails) say('\nNew baseline (paste into EQUIV_BASELINE if the change was intended):\n' + JSON.stringify(now));
  document.title = fails || /differ/.test(workerNote) ? 'EQUIV FAIL' : 'EQUIV PASS';
}

initUI();
if (location.hash.startsWith('#gifcheck=')) (async () => {   // diagnostics: #gifcheck=<file urls, comma separated>
  const out = $('#selftest'); out.hidden = false; const log = [];
  for (const url of decodeURIComponent(location.hash.slice(10)).split(',')) {
    const name = url.split('/').pop(); let line = name + ': ';
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      const d = new Uint8Array(buf), fmt = sniffFormat(d.subarray(0, 64)); line += `sniff=${fmt} `;
      const step = t => { out.textContent = log.concat(line + ' [' + t + ']').join(String.fromCharCode(10)); };
      step('parse');
      let own = null;
      try {
        if (fmt === 'gif') line += `own=${decodeGIF(buf).frames.length} `;
        else if (fmt === 'png' && isAPNG(d)) { const p = parseAPNG(d); step('composite ' + p.frames.length); own = await compositeFrames(p); line += `ownAPNG=${own.length} `; }
        else if (fmt === 'webp' && isAnimatedWebP(d)) { const p = parseAnimWebP(d); step('composite ' + p.frames.length); own = await compositeFrames(p); line += `ownWEBP=${own.length} `; }
      } catch (e) { line += `own=ERR(${e.message}) `; }
      step('browser'); if (fmt && fmt !== 'video') try {
        const dec = new ImageDecoder({ data: buf, type: SNIFF_MIME[fmt] }); await dec.tracks.ready; await dec.completed;
        const n = dec.tracks.selectedTrack.frameCount; line += `browser=${n} `;
        if (own && own.length === n && n > 2) {   // compare our compositing with the browser's, pixel by pixel, on a middle and the last frame
          let maxDiff = 0;
          for (const fi of [Math.floor(n / 2), n - 1]) {
            const { image } = await dec.decode({ frameIndex: fi }), W = image.displayWidth, H = image.displayHeight;
            const c1 = document.createElement('canvas'), c2 = document.createElement('canvas'); c1.width = c2.width = W; c1.height = c2.height = H;
            const g1 = c1.getContext('2d', { willReadFrequently: true }), g2 = c2.getContext('2d', { willReadFrequently: true });
            g1.drawImage(image, 0, 0); g2.drawImage(own[fi].bmp, 0, 0); image.close();
            const a = g1.getImageData(0, 0, W, H).data, b = g2.getImageData(0, 0, W, H).data;
            for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
          }
          line += `pixelDiff=${maxDiff} `;
        }
        dec.close();
      } catch (e) { line += `browser=ERR(${e.message}) `; }
      step('open'); await openFile(new File([buf], name, { type: name.endsWith('.gif') ? 'image/gif' : '' }));
      line += `opened=${App.src.kind}${App.src.frames ? '/' + App.src.frames.length : ''} player=${!$('#player').hidden}`;
    } catch (e) { line += 'FAILED ' + e.message; }
    log.push(line); out.textContent = log.join('\n');
  }
  document.title = 'GIFCHECK DONE';
})();
else if (location.hash.startsWith('#equiv')) equivTest();
else if (location.hash.startsWith('#selftest')) selfTest();
else if (location.hash.startsWith('#exp')) (async () => {
  const out = $('#selftest'); out.hidden = false; const log = [], NL = String.fromCharCode(10);
  const say = l => { log.push(l); out.textContent = log.join(NL); };
  try { const gl = document.createElement('canvas').getContext('webgl'); const e = gl.getExtension('WEBGL_debug_renderer_info'); say('GPU: ' + gl.getParameter(e.UNMASKED_RENDERER_WEBGL)); } catch (e) { say('GPU: ?'); }
  const big = document.createElement('canvas'); big.width = 1920; big.height = 1080;
  big.getContext('2d').drawImage(demoCanvas(), 0, 0, 1920, 1080);
  const bmp = await createImageBitmap(big);
  const cpuBig = document.createElement('canvas'); cpuBig.width = 1920; cpuBig.height = 1080; cpuBig.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
  const time = (fn, k = 10) => { fn(); const t = performance.now(); for (let i = 0; i < k; i++) fn(); return ((performance.now() - t) / k).toFixed(2); };
  const St = Object.assign({}, DEFAULTS);
  const W = 240, H = 136;
  const dst = document.createElement('canvas'); dst.width = W; dst.height = H; const dctx = dst.getContext('2d', { willReadFrequently: true });
  say('A current (bitmap, gpu work) ' + time(() => { drawTransformed(dctx, bmp, 1920, 1080, W, H, St); dctx.getImageData(0, 0, W, H); }));
  say('A2 current hi 960x544 ' + time(() => { const c = hiCanvas; c.width = 960; c.height = 544; drawTransformed(hiCtx, bmp, 1920, 1080, 960, 544, St); hiCtx.getImageData(0, 0, 960, 544); }));
  const wa = work.a, wb = work.b;
  work.a = document.createElement('canvas'); work.b = document.createElement('canvas'); work.a.getContext('2d', { willReadFrequently: true }); work.b.getContext('2d', { willReadFrequently: true });
  say('B cpu work canvases ' + time(() => { drawTransformed(dctx, bmp, 1920, 1080, W, H, St); dctx.getImageData(0, 0, W, H); }));
  say('C cpu source + cpu work ' + time(() => { drawTransformed(dctx, cpuBig, 1920, 1080, W, H, St); dctx.getImageData(0, 0, W, H); }));
  say('C2 cpu source hi 960x544 ' + time(() => { drawTransformed(hiCtx, cpuBig, 1920, 1080, 960, 544, St); hiCtx.getImageData(0, 0, 960, 544); }));
  const small = document.createElement('canvas'); small.width = 960; small.height = 540; small.getContext('2d', { willReadFrequently: true }).drawImage(cpuBig, 0, 0, 960, 540);
  say('D pre-shrunk cpu source 960 -> grid ' + time(() => { drawTransformed(dctx, small, 960, 540, W, H, St); dctx.getImageData(0, 0, W, H); }));
  say('D2 pre-shrunk -> hi ' + time(() => { drawTransformed(hiCtx, small, 960, 540, 960, 544, St); hiCtx.getImageData(0, 0, 960, 544); }));
  say('E getImageData only (hi) ' + time(() => hiCtx.getImageData(0, 0, 960, 544)));
  say('F createImageBitmap resize ' + time(() => {}, 1));
  let t = performance.now(); for (let i = 0; i < 5; i++) { const b = await createImageBitmap(bmp, { resizeWidth: 960, resizeHeight: 540, resizeQuality: 'high' }); dctx.drawImage(b, 0, 0); dctx.getImageData(0, 0, 1, 1); b.close(); } say('F bitmap resize+draw ' + ((performance.now() - t) / 5).toFixed(2));
  work.a = wa; work.b = wb;
  document.title = 'EXP DONE';
})();
else if (location.hash.startsWith('#bench')) (async () => {   // timing: #bench[;cols=160]
  const out = $('#selftest'); out.hidden = false; const log = [], NL = String.fromCharCode(10);
  const say = l => { log.push(l); out.textContent = log.join(NL); };
  const cols = +((/cols=(\d+)/.exec(location.hash) || [])[1] || 120);
  const big = document.createElement('canvas'); big.width = 1920; big.height = 1080;
  const g = big.getContext('2d'); g.drawImage(demoCanvas(), 0, 0, 1920, 1080);
  const id = g.getImageData(0, 0, 1920, 1080), dd = id.data;
  for (let i = 0; i < dd.length; i += 4) { const n = (hashNoise(i >> 2, 7) - 0.5) * 40; dd[i] += n; dd[i + 1] += n; dd[i + 2] += n; }
  g.putImageData(id, 0, 0);
  const bmp = await createImageBitmap(big);
  const time = (fn, k = 5) => { fn(); const t = performance.now(); for (let i = 0; i < k; i++) fn(); return (performance.now() - t) / k; };
  const c = document.createElement('canvas');
  let tot = 0;
  for (const name of Object.keys(PRESETS)) {
    const St = Object.assign({}, DEFAULTS, PRESET_BASE, PRESETS[name], { cols });
    let r; const tc = time(() => { r = convert(bmp, 1920, 1080, St); });
    const tr = time(() => renderResult(r, St, c, 1));
    const tn = time(() => convert(bmp, 1920, 1080, Object.assign({}, St, { outline: 0 })));
    tot += tc + tr;
    say(`${name.padEnd(28)} convert ${tc.toFixed(1).padStart(6)} ms (no outline ${tn.toFixed(1).padStart(6)})  draw ${tr.toFixed(1).padStart(6)} ms  ${r.cols}x${r.rows}`);
  }
  say('TOTAL ' + tot.toFixed(0) + ' ms');
  await demoImage(); await nextTick();
  let t = performance.now(); for (let i = 0; i < 5; i++) renderNow(); say('renderNow (demo, defaults) ' + ((performance.now() - t) / 5).toFixed(1) + ' ms');
  t = performance.now(); await renderLooks(); say('looks gallery ' + (performance.now() - t).toFixed(0) + ' ms');
  S.exportGoal = 'save'; applyGoal(); t = performance.now(); await estimateSizes(); say('size estimate ' + (performance.now() - t).toFixed(0) + ' ms');
  document.title = 'BENCH DONE';
})();
else if (location.hash.startsWith('#demo=')) {   // e.g. #demo=ASCII%3A%20colour;platform=instagram;view=platform
  const [preset, ...kv] = decodeURIComponent(location.hash.slice(6)).split(';');
  if (PRESETS[preset]) Object.assign(S, PRESETS[preset]);
  const o = Object.fromEntries(kv.map(x => x.split('=')));
  if (o.platform && PLATFORMS[o.platform]) S.platform = o.platform;
  if (o.cols) S.cols = +o.cols;
  if (o.outline) S.outline = +o.outline;
  S.shareOptimize = o.fix === '1'; S.shareSplit = o.split === '1'; S.shareColor = o.colour === '1'; S.shareTarget = o.target || 'phone';
  demoImage().then(() => { syncControls(); if (o.view) setView(o.view); if (o.cal === '1') setTimeout(openCalibration, 300); });
}
else if (location.hash === '#demo') demoImage();
else if (location.hash.startsWith('#demoanim')) { const gm = /goal=(\w+)/.exec(location.hash); if (gm) S.exportGoal = gm[1]; demoAnim(); }
