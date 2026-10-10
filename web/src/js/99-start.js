/* =====================================================================
   Start: build the UI, then run a test or demo when the address asks for one (#selftest, #equiv, #uitest, #demo…)
   ===================================================================== */
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
else if (location.hash.startsWith('#uitest')) uiTest();
else if (location.hash.startsWith('#videotest')) videoTest();
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
