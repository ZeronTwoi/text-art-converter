/* =====================================================================
   Self-test (open index.html#selftest): GIF round-trip, ZIP CRC, all modes
   ===================================================================== */
async function selfTest() {
  const out = $('#selftest'); out.hidden = false;
  const log = [], ok = (name, cond) => { log.push((cond ? 'PASS ' : 'FAIL ') + name); out.textContent = log.join('\n'); return cond; };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  let seed = 12345; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  for (const [w, h, ncol, label] of [[300, 200, 256, 'random 256 colours (forces table resets)'], [64, 48, 2, '2 colours'], [37, 23, 16, '16 colours, odd size'], [1, 1, 4, '1 pixel']]) {
    let size = 2; while (size < ncol) size <<= 1;
    const pal = new Uint8Array(size * 3); for (let i = 0; i < size * 3; i++) pal[i] = (rnd() * 256) | 0;
    const enc = new GifEncoder(w, h, 0), frames = [];
    for (let f = 0; f < 3; f++) {
      const ind = new Uint8Array(w * h);
      for (let i = 0; i < ind.length; i++) ind[i] = f === 1 ? ((i >> 4) % ncol) : (rnd() * ncol) | 0;
      frames.push(ind); enc.addFrame(ind, pal, size, 5, -1, 1);
    }
    const bytes = enc.finish();
    const dec = decodeGIF(bytes.buffer);
    let good = dec.frames.length === 3 && dec.width === w && dec.height === h;
    for (let f = 0; good && f < 3; f++) {
      const d = dec.frames[f].data.data, ind = frames[f];
      for (let i = 0; i < ind.length; i++) { const p = ind[i] * 3; if (d[i * 4] !== pal[p] || d[i * 4 + 1] !== pal[p + 1] || d[i * 4 + 2] !== pal[p + 2]) { good = false; break; } }
    }
    ok('GIF round-trip: ' + label, good);
    if ('ImageDecoder' in window) {   // cross-check with the browser's own GIF decoder
      try {
        const bd = new ImageDecoder({ data: bytes.buffer, type: 'image/gif' });
        await withTimeout(bd.tracks.ready, 3000); await withTimeout(bd.completed, 3000);
        let bgood = bd.tracks.selectedTrack.frameCount === 3;
        const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
        for (let f = 0; bgood && f < 3; f++) {
          const { image } = await withTimeout(bd.decode({ frameIndex: f }), 3000); g.clearRect(0, 0, w, h); g.drawImage(image, 0, 0); image.close();
          const d = g.getImageData(0, 0, w, h).data, ind = frames[f];
          for (let i = 0; i < ind.length; i++) { const p = ind[i] * 3; if (Math.abs(d[i * 4] - pal[p]) > 1 || Math.abs(d[i * 4 + 1] - pal[p + 1]) > 1 || Math.abs(d[i * 4 + 2] - pal[p + 2]) > 1) { bgood = false; break; } }
        }
        bd.close();
        ok('Browser decodes our GIF: ' + label, bgood);
      } catch (e) { ok('Browser decodes our GIF: ' + label + ' (' + e.message + ')', false); }
    }
  }
  ok('CRC32 check value', crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
  const q = quantizeRGBA(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]), 256, true);
  ok('Quantiser keeps transparency', q.ind[2] === 0 && q.ind[0] !== 0 && q.ind[1] !== 0);
  await demoImage();
  const saved = Object.assign({}, S);
  for (const mode of Object.keys(MODES)) {
    if (mode === 'text') continue;
    for (const cm of ['mono', 'color']) {
      try {
        Object.assign(S, { mode, colorMode: cm, cols: 80 });
        const res = convert(App.src.bmp, App.src.w, App.src.h, S);
        const c = document.createElement('canvas'); renderResult(res, S, c, 1);
        const txt = resultText(res), svg = resultSVG(res, S), ansi = resultANSI(res);
        ok(`convert ${mode}/${cm}: ${res.cols}x${res.rows}, text ${txt.length} chars, ink cells ${Array.from(res.cp).filter(v => !isBlankCp(v)).length}`, res.rows > 10 && txt.split('\n').length === res.rows && svg.length > 100 && ansi.length > txt.length);
      } catch (e) { ok(`convert ${mode}/${cm}: ${e.message}`, false); }
    }
  }
  Object.assign(S, saved);
  try {
    Object.assign(S, { mode: 'braille', colorMode: 'mono', cols: 40, brailleBlank: 'space' });
    const rb = convert(App.src.bmp, App.src.w, App.src.h, S);
    const ig = platformText(rb, PLATFORMS.instagram, false), wa = platformText(rb, PLATFORMS.whatsapp, false), rd = platformText(rb, PLATFORMS.reddit, false);
    ok('Instagram braille copy has no collapsible spaces', !/ /.test(ig));
    ok('WhatsApp copy is wrapped in a ``` code block', wa.startsWith('```\n') && wa.endsWith('\n```'));
    ok('Reddit copy is 4-space indented', rd.split('\n').every(l => l.startsWith('    ')));
    ok('X counts braille as double width', platformLength('⣿a', PLATFORMS.x) === 3);
    Object.assign(S, { mode: 'ascii', colorMode: 'color', cols: 120, platform: 'instagram' });
    const ra = convert(App.src.bmp, App.src.w, App.src.h, S), ch = shareChecks(ra, S, false);
    ok('ASCII on Instagram is flagged as broken', ch.some(c => c.lvl === 'bad' && /proportional/.test(c.msg)));
    ok('Colour loss is warned about', ch.some(c => /Colours are lost/.test(c.msg)));
    S.platform = 'discord';
    const big = shareChecks(ra, S, false);
    ok('Over-limit Discord message is flagged with a fix', big.some(c => c.lvl === 'bad' && /Too long/.test(c.msg) && c.fix));
    const da = discordANSI(ra);
    ok('Discord ANSI uses only 8 basic colours', !/\u001b\[0;(?!3[0-7]m)/.test(da) && da.includes('\u001b[0;3'));
    for (const [pk, maxCols] of [['instagram', 28], ['discord', 42], ['x', 30]]) {
      Object.assign(S, { mode: 'ascii', colorMode: 'color', cols: 120, platform: pk, shareOptimize: true, dither: 'atkinson', shareColor: false, shareSplit: false, shareTarget: 'phone' });
      App.res = convert(App.src.bmp, App.src.w, App.src.h, S);
      const before = JSON.stringify(S); computeShare();
      const P = PLATFORMS[pk], r = App.shareRes, after = shareChecks(r, App.shareSettings, true);
      ok(`Fix all (${pk}): main settings unchanged`, JSON.stringify(S) === before && S.mode === 'ascii' && S.cols === 120);
      ok(`Fix all (${pk}): copy fits ${P.limit} chars & ${maxCols} cols (${r.cols} cols, ${platformLength(platformText(r, P, false), P)} chars)`, r.cols <= maxCols && platformLength(platformText(r, P, false), P) <= P.limit);
      ok(`Fix all (${pk}): style/colours/dither kept where possible`, App.shareSettings.colorMode === 'color' && App.shareSettings.dither === 'atkinson' && r.mode === (P.wrap === 'none' ? 'braille' : 'ascii'));
      ok(`Fix all (${pk}): no blocking issues left`, !after.some(c => c.lvl === 'bad'));
    }
    ok('Discord colours picked by hue', discordCode(230, 30, 30) === 31 && discordCode(30, 60, 230) === 34 && discordCode(240, 240, 240) === 37 && discordCode(30, 30, 30) === 30 && discordCode(40, 200, 60) === 32);
    const conv = () => { App.res = convert(App.src.bmp, App.src.w, App.src.h, S); computeShare(); };
    Object.assign(S, { mode: 'braille', colorMode: 'color', cols: 120, platform: 'discord', shareOptimize: true, shareColor: true, shareSplit: false, shareTarget: 'phone' }); conv();
    const c1 = App.shareParts;
    ok(`Colour copy fixed to fit one Discord message (${c1[0].length} chars, ${App.shareRes.cols} cols)`, c1.length === 1 && c1[0].length <= 2000 && c1[0].startsWith('```ansi\n') && /\u001b\[0;3[0-7]m/.test(c1[0]) && S.cols === 120);
    S.colorMode = 'mono'; conv();
    ok('Colour copy uses colours even if the editor is single-colour', App.shareSettings.colorMode === 'app' && S.colorMode === 'mono' && new Set(App.shareParts[0].match(/\u001b\[0;3\dm/g) || []).size > 1);
    Object.assign(S, { colorMode: 'color', shareColor: false, shareSplit: true, shareTarget: 'desktop' }); conv();
    const ps = App.shareParts;
    ok(`Desktop + split keeps ${App.shareRes.cols} columns across ${ps.length} messages`, App.shareRes.cols === 90 && ps.length > 1 && ps.length <= MAX_PARTS && ps.every(p => p.length <= 2000 && p.startsWith('```\n') && p.endsWith('\n```')));
    ok('Split messages rejoin into the full picture', ps.map(p => stripWrap(p, PLATFORMS.discord)).join('\n') === resultText(App.shareRes));
    S.shareColor = true; conv();
    ok(`Colour + split: ${App.shareParts.length} colour messages, each under the limit`, App.shareParts.every(p => p.length <= 2000 && p.startsWith('```ansi\n')) && App.shareParts.length <= MAX_PARTS);
    const tc = document.createElement('canvas'); tc.width = 400; tc.height = 300; const tg = tc.getContext('2d');
    tg.fillStyle = '#fff'; tg.fillRect(0, 0, 400, 300); tg.fillStyle = '#c00'; tg.fillRect(150, 100, 100, 100);
    const trm = autoTrimRect(tc, 400, 300);
    ok('Auto-trim finds the subject', !!trm && trm.l > 30 && trm.r > 30 && trm.t > 25 && trm.b > 25);
    Object.assign(S, { mode: 'braille', cols: 40, shareOptimize: false, sharpen: 0 }); const s0 = resultText(convert(App.src.bmp, App.src.w, App.src.h, S));
    S.sharpen = 1; ok('Sharpen changes the conversion', resultText(convert(App.src.bmp, App.src.w, App.src.h, S)) !== s0);
  } catch (e) { ok('share checks: ' + e.message, false); }
  try {   // ---- outline engine on synthetic images ----
    const mkCanvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); return c; };
    const base = { mode: 'braille', colorMode: 'mono', fg: '#000000', bg: '#ffffff', cols: 60, charAspect: 2, dither: 'floyd', threshold: 0.5, brightness: 0, contrast: 0, gamma: 1, saturation: 1, invert: false, autoLevels: false, sharpen: 0, edge: 0, fill: 1, localContrast: 0, bgFade: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0, rotate: 0, flipH: false, flipV: false, outlineWidth: 1, outlineDir: true, brailleBlank: 'braille', charset: 'standard', sortRamp: false };
    // a light-grey box on white: almost no tonal difference, so without outlines it nearly vanishes
    const box = mkCanvas(480, 320, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 480, 320); g.fillStyle = '#dcdcdc'; g.fillRect(120, 80, 240, 160); });
    const cellOn = (r, cx, cy) => r.bits[cy * r.cols + cx] !== 0;
    const perimeter = r => { let hit = 0, tot = 0;
      for (let cx = 17; cx <= 43; cx++) { tot += 2; if (cellOn(r, cx, 4) || cellOn(r, cx, 5)) hit++; if (cellOn(r, cx, 14) || cellOn(r, cx, 15)) hit++; }
      for (let cy = 6; cy <= 13; cy++) { tot += 2; if (cellOn(r, 14, cy) || cellOn(r, 15, cy)) hit++; if (cellOn(r, 44, cy) || cellOn(r, 45, cy)) hit++; }
      return hit / tot; };
    const inside = r => { let on = 0, t = 0; for (let cy = 7; cy <= 12; cy++) for (let cx = 18; cx <= 41; cx++) { t++; if (cellOn(r, cx, cy)) on++; } return on / t; };
    const rNo = convert(box, 480, 320, Object.assign({}, base, { outline: 0 }));
    const rLine = convert(box, 480, 320, Object.assign({}, base, { outline: 0.5, fill: 0 }));
    const rBoth = convert(box, 480, 320, Object.assign({}, base, { outline: 0.5, fill: 1 }));
    ok(`Faint box: with outlines border ${(perimeter(rLine) * 100).toFixed(0)}% vs inside ${(inside(rLine) * 100).toFixed(0)}% inked; without outlines border ${(perimeter(rNo) * 100).toFixed(0)}% vs inside ${(inside(rNo) * 100).toFixed(0)}% (no visible edge)`, perimeter(rLine) >= 0.9);
    ok(`Line-art mode keeps the inside clean (${(inside(rLine) * 100).toFixed(1)}% of inner cells inked)`, inside(rLine) < 0.05);
    ok('Outlines are added on top of shading', perimeter(rBoth) >= 0.9 && inside(rBoth) >= inside(rLine));
    // a 2-px diagonal line: must become / characters in ASCII
    const diag = mkCanvas(480, 320, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 480, 320); g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(90, 300); g.lineTo(370, 20); g.stroke(); });
    const ra = convert(diag, 480, 320, Object.assign({}, base, { mode: 'ascii', cols: 48, outline: 0.5, fill: 0 }));
    const chars = Array.from(resultText(ra)).filter(ch => ch !== ' ' && ch !== '\n');
    const slash = chars.filter(ch => ch === '/').length;
    ok(`Thin 45° line becomes "/" in ASCII (${slash}/${chars.length} drawn chars)`, chars.length >= 20 && slash / chars.length >= 0.7);
    const vert = mkCanvas(400, 300, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#000'; g.fillRect(200, 0, 200, 300); });
    const rv = resultText(convert(vert, 400, 300, Object.assign({}, base, { mode: 'ascii', cols: 40, outline: 0.5, fill: 0 })));
    ok('Vertical edge becomes "|"', rv.split('\n').filter(l => l.includes('|')).length >= rv.split('\n').length * 0.8);
    // background fade: subject on a plain background
    const subj = mkCanvas(400, 300, g => { g.fillStyle = '#30a0e0'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#ffe080'; g.beginPath(); g.arc(200, 150, 80, 0, 7); g.fill(); });
    const s1 = convert(subj, 400, 300, Object.assign({}, base, { colorMode: 'mono', fg: '#ffffff', bg: '#000000', outline: 0, bgFade: 0 }));
    const s2 = convert(subj, 400, 300, Object.assign({}, base, { colorMode: 'mono', fg: '#ffffff', bg: '#000000', outline: 0, bgFade: 1 }));
    const corner = r => { let on = 0; for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 10; cx++) if (r.bits[cy * r.cols + cx]) on++; return on; };
    ok(`Background fade clears the background (${corner(s1)} → ${corner(s2)} inked corner cells)`, corner(s1) > 10 && corner(s2) === 0);
    if (location.hash === '#selftest-debug') log.push('DIAG\n' + resultText(ra).split('\n').slice(0, 8).join('\n'), 'S1\n' + resultText(s1).split('\n').slice(0, 4).join('\n'));
  } catch (e) { ok('outline engine: ' + e.message, false); }
  const srcSaved = App.src, resSaved = App.res;
  try {   // ---- chat theme & phone calibration ----
    const half = document.createElement('canvas'); half.width = 400; half.height = 300;
    const hg = half.getContext('2d'); hg.fillStyle = '#fff'; hg.fillRect(0, 0, 200, 300); hg.fillStyle = '#000'; hg.fillRect(200, 0, 200, 300);
    App.src = { kind: 'image', bmp: half, w: 400, h: 300, name: 'half.png' };
    Object.assign(S, { mode: 'braille', colorMode: 'mono', fg: '#e8e6e3', bg: '#0b0d12', cols: 40, outline: 0, fill: 1, edge: 0, sharpen: 0, localContrast: 0, bgFade: 0, autoLevels: false, invert: false, dither: 'floyd', shareOptimize: false, shareTheme: 'auto', shareTarget: 'phone', calib: {}, cropL: 0, cropR: 0, cropT: 0, cropB: 0 });
    const inkLR = r => { let l = 0, rr = 0; for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.cols; x++) if (r.bits[y * r.cols + x]) { if (x < r.cols / 2 - 1) l++; else if (x > r.cols / 2) rr++; } return [l, rr]; };
    S.platform = 'whatsapp'; App.res = convert(half, 400, 300, S); computeShare();
    const [el, er] = inkLR(App.res), [sl, sr] = inkLR(App.shareRes);
    ok(`WhatsApp (light theme): copy inks the dark half, editor inks the bright half (editor ${el}|${er}, copy ${sl}|${sr})`, el > 100 && er === 0 && sl === 0 && sr > 100 && (App.shareAuto || []).length === 1);
    S.platform = 'discord'; App.res = convert(half, 400, 300, S); computeShare();
    ok('Discord (dark theme): copy is the editor result, no swap needed', App.shareRes === App.res && !(App.shareAuto || []).length);
    S.shareTheme = 'light'; computeShare();
    ok('Chat theme override (light) swaps on Discord too', App.shareRes !== App.res && inkLR(App.shareRes)[0] === 0);
    S.shareTheme = 'auto';
    App.src = srcSaved;
    Object.assign(S, { cols: 120, calib: { discord: { cols: 28, aspect: 2.3 } }, shareOptimize: true });
    App.res = convert(App.src.bmp, App.src.w, App.src.h, S); computeShare();
    const g2 = gridFor(App.src.w, App.src.h, App.shareSettings);
    ok(`Calibration applied: ${App.shareRes.cols} cols ≤ 28, shape ${App.shareSettings.charAspect}, ${App.shareRes.rows} rows`, App.shareRes.cols <= 28 && App.shareSettings.charAspect === 2.3 && App.shareRes.rows === g2.rows && S.charAspect === 2);
    ok('Phone copy uses cleaner dithering', App.shareSettings.dither === 'atkinson' && S.dither === 'floyd');
    // the calibration ring for aspect a is round when drawn with cells of that shape
    const roundness = a => { const rows = ringRows(a); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      rows.forEach((row, ry) => Array.from(row).forEach((ch, c) => { const b = ch.codePointAt(0) - 0x2800;
        for (let j = 0; j < 8; j++) if (b & (1 << j)) { const [dx, dy] = BRAILLE_POS[j]; const x = c * 2 + dx, y = (ry * 4 + dy) * a / 2; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
      return (y1 - y0) / (x1 - x0); };
    ok(`Test-card rings are round at their own shape (${CAL_ASPECTS.map(a => roundness(a).toFixed(2)).join(', ')})`, CAL_ASPECTS.every(a => Math.abs(roundness(a) - 1) < 0.12));
    const card = testCardRows();
    ok('Test card has bars 20…64 characters long', card.filter(r => /^\d+⠀⣿+$/.test(r)).every(r => Array.from(r).length === parseInt(r, 10) + String(parseInt(r, 10)).length + 1));
    // App colours: only colours the target can show
    App.src = srcSaved;
    for (const [pal, P] of [['discord', Object.values(DISCORD_CSS).map(hexToRgb)], ['ansi16', ANSI16], ['ansi256', ANSI256]]) {
      const r = convert(App.src.bmp, App.src.w, App.src.h, Object.assign({}, S, { mode: 'braille', colorMode: 'app', appPalette: pal, cols: 60, shareOptimize: false }));
      const keys = new Set(P.map(c => (c[0] << 16) | (c[1] << 8) | c[2])), used = new Set();
      let okAll = true; for (let c = 0; c < r.cols * r.rows; c++) { const o = c * 3, k = (r.fg[o] << 16) | (r.fg[o + 1] << 8) | r.fg[o + 2]; used.add(k); if (!keys.has(k)) { okAll = false; break; } }
      ok(`App colours (${pal}): every cell uses the ${P.length}-colour palette (${used.size} used)`, okAll && used.size > 1);
      if (pal === 'discord') { const codes = new Set((discordANSI(r).match(/\[0;(3\d)m/g) || [])); ok('Discord copy of App colours keeps the same colours', codes.size === used.size); }
      if (pal === 'ansi16') { const sv = S.colorMode, sp = S.appPalette; S.colorMode = 'app'; S.appPalette = 'ansi16'; const a = resultANSI(r); S.colorMode = sv; S.appPalette = sp;
        ok('Terminal 16-colour ANSI uses only basic colour codes', !/\[38;/.test(a) && /\[(3[0-7]|9[0-7])m/.test(a)); }
    }
  } catch (e) { ok('theme/calibration: ' + e.message, false); }
  App.src = srcSaved; App.res = resSaved;
  try {   // ---- size & quality ----
    Object.assign(S, saved);
    applyQuality('small'); const qs = currentQuality(); applyQuality('high');
    ok('Quality presets apply and are recognised', qs === 'small' && currentQuality() === 'high' && S.exportScale === 2 && S.gifColors === 256);
    S.exportScale = 1.25; ok('Hand-changed settings show as custom', currentQuality() === 'custom');
    await demoAnim(); applyQuality('balanced'); S.exportGoal = 'save'; S.mode = 'braille'; S.cols = 80;
    App.res = convert(App.src.frames[0].bmp, App.src.w, App.src.h, S); buildExportPanel();
    await estimateSizes();
    const estTxt = ($('[data-est="gif"] .sz') || {}).textContent || '';
    const parse = t => { const m = /([\d.]+)\s*(B|KB|MB)/.exec(t); return m ? +m[1] * { B: 1, KB: 1024, MB: 1048576 }[m[2]] : NaN; };
    // the real export, with the same settings
    const grab = async fn => { const keep = download; let blob = null; download = bl => { blob = bl; }; try { await fn(); } finally { download = keep; } return blob ? new Uint8Array(await blob.arrayBuffer()) : null; };
    const realBytes = await grab(exportGIF), real = realBytes ? realBytes.length : NaN, est = parse(estTxt);
    ok(`GIF size estimate ${estTxt} vs real ${fmtBytes(real)} (within 35%)`, isFinite(est) && Math.abs(est - real) / real < 0.35);
    // GIF options: the same picture, smaller files
    const gifOf = async patch => { Object.assign(S, { gifColors: 256 }, patch); return grab(exportGIF); };
    const full = await gifOf({ gifDiff: false, gifPalette: 'frame', gifDither: false }), small = await gifOf({ gifDiff: true }), shared = await gifOf({ gifDiff: true, gifPalette: 'global' }), dith = await gifOf({ gifDiff: false, gifDither: true });
    S.gifDiff = true; S.gifPalette = 'frame'; S.gifDither = false;
    const fa = decodeGIF(full.buffer).frames;
    const near = (A, B) => { if (A.length !== B.length) return Infinity; let mx = 0; A.forEach((f, i) => { const x = f.data.data, y = B[i].data.data; for (let j = 0; j < x.length; j++) mx = Math.max(mx, Math.abs(x[j] - y[j])); }); return mx; };
    const dSmall = near(fa, decodeGIF(small.buffer).frames), dShared = near(fa, decodeGIF(shared.buffer).frames);
    ok(`GIF "only what changes": same frames (max difference ${dSmall}), ${fmtBytes(small.length)} instead of ${fmtBytes(full.length)}`, dSmall <= 16 && small.length <= full.length);
    ok(`GIF with one palette for all frames: same frames (max difference ${dShared}), ${fmtBytes(shared.length)}`, dShared <= 24 && shared.length < full.length);
    ok(`GIF with dithering decodes (${decodeGIF(dith.buffer).frames.length} frames)`, decodeGIF(dith.buffer).frames.length === fa.length);
    const pngTxt = ($('[data-est="png"] .sz') || {}).textContent || '';
    ok(`Picture sizes shown on buttons (PNG ${pngTxt})`, /\d/.test(pngTxt));
    {   // a mostly still animation (a small square moves over the demo picture)
      const base = demoCanvas(), still = [];
      for (let i = 0; i < 20; i++) { const c2 = document.createElement('canvas'); c2.width = 480; c2.height = 320; const g2 = c2.getContext('2d'); g2.drawImage(base, 0, 0, 480, 320); g2.fillStyle = '#fff'; g2.fillRect(40 + i * 12, 240, 36, 36); still.push({ bmp: await createImageBitmap(c2), delay: 80 }); }
      const an = makeAnim(still, 480, 320); an.name = 'still.gif'; setSource(an); setPlaying(false);
      const f2 = await gifOf({ gifDiff: false }), s2 = await gifOf({ gifDiff: true }); S.gifDiff = true;
      const d2 = near(decodeGIF(f2.buffer).frames, decodeGIF(s2.buffer).frames);
      ok(`GIF "only what changes" on a mostly still animation: ${fmtBytes(s2.length)} instead of ${fmtBytes(f2.length)} (max difference ${d2})`, d2 <= 16 && s2.length < f2.length * 0.4);
      // APNG / animated WEBP of the same animation: decoded by the browser, compared with the frames drawn directly
      if ('ImageDecoder' in window) {
        const refs = [], c3 = document.createElement('canvas'), g3 = c3.getContext('2d', { willReadFrequently: true });
        for (const f of App.src.frames) { renderResult(convert(f.bmp, App.src.w, App.src.h, S), S, c3, S.exportScale); refs.push(g3.getImageData(0, 0, c3.width, c3.height).data); }
        const decodeAll = async (bytes, type) => {
          const d = new ImageDecoder({ data: bytes, type }); await d.tracks.ready; await d.completed;
          const out = [];
          for (let i = 0; i < d.tracks.selectedTrack.frameCount; i++) { const { image } = await d.decode({ frameIndex: i }); const t = document.createElement('canvas'); t.width = image.displayWidth; t.height = image.displayHeight; const tg = t.getContext('2d', { willReadFrequently: true }); tg.drawImage(image, 0, 0); image.close(); out.push(tg.getImageData(0, 0, t.width, t.height).data); }
          d.close(); return out;
        };
        for (const dv of [true, false]) {
          S.gifDiff = dv;
          const ap = await grab(() => exportAnimated('apng')), apF = await decodeAll(ap, 'image/png');
          let mx = 0; apF.forEach((f, i) => { for (let j = 0; j < f.length; j++) mx = Math.max(mx, Math.abs(f[j] - refs[i][j])); });
          ok(`APNG${dv ? ' (only what changes)' : ''}: ${apF.length} frames, exact colours (max difference ${mx}), ${fmtBytes(ap.length)}`, apF.length === refs.length && mx === 0);
        }
        if (FAST_VIDEO_OK) for (const ext of ['mp4', 'webm']) {   // videos encoded faster than real time, frames at the right times
          const vrefs = App.src.frames.map(f => { const rc = document.createElement('canvas'); renderResult(convert(f.bmp, App.src.w, App.src.h, S), S, rc, S.exportScale, { even: true, bgMode: 'solid' }); return rc.getContext('2d').getImageData(0, 0, rc.width, rc.height).data; });
          const t0 = performance.now(), vb = await grab(() => exportVideoFast(ext)), ms = performance.now() - t0;
          const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([vb], { type: 'video/' + ext }));
          let best = -1;
          try {
            await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('cannot play')); setTimeout(() => rej(new Error('timeout')), 8000); });
            v.currentTime = App.src.frames[10].t0 + 0.02; await new Promise(r => { v.onseeked = r; setTimeout(r, 4000); });
            const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; const cg = cv.getContext('2d', { willReadFrequently: true }); cg.drawImage(v, 0, 0);
            const px = cg.getImageData(0, 0, cv.width, cv.height).data; let be = Infinity;
            vrefs.forEach((rp, i) => { if (rp.length !== px.length) return; let e = 0; for (let k = 0; k < px.length; k += 16) e += Math.abs(px[k] - rp[k]); if (e < be) { be = e; best = i; } });
          } catch (e) { best = -2; }
          ok(`${ext.toUpperCase()} encoded in ${ms.toFixed(0)} ms for ${App.src.duration.toFixed(2)} s, duration ${v.duration.toFixed(2)} s, frame 11 shows frame ${best + 1}`, Math.abs(v.duration - App.src.duration) < 0.1 && best === 10);
        }
        S.gifDiff = true;
        if (ANIM_WEBP_OK) {
          const wp = await grab(() => exportAnimated('webp')), wpF = await decodeAll(wp, 'image/webp');
          let sum = 0, cnt = 0; wpF.forEach((f, i) => { for (let j = 0; j < f.length; j += 4) { sum += Math.abs(f[j] - refs[i][j]); cnt++; } });
          ok(`Animated WEBP: ${wpF.length} frames, mean error ${(sum / cnt).toFixed(2)}, ${fmtBytes(wp.length)}`, wpF.length === refs.length && sum / cnt < 8);
        }
      }
    }
  } catch (e) { ok('size & quality: ' + e.message, false); }
  Object.assign(S, saved); await demoImage();   // the demo animation above disposed the saved source
  try {   // ---- undo / redo and your own looks ----
    History.commit(); const b0 = S.brightness;
    applySettings({ brightness: 0.37 }); applySettings({ brightness: 0.41 }); History.commit();
    History.step(true); const afterUndo = S.brightness; History.step(false);
    ok('Undo restores the value before the change, redo re-applies it', afterUndo === b0 && S.brightness === 0.41);
    const keep = JSON.stringify(userLooks);
    applySettings({ mode: 'quad', fg: '#123456', cols: 77 }); saveUserLook('Selftest look');
    applySettings({ mode: 'ascii', fg: '#ffffff', cols: 90 }); applyPreset('user:Selftest look');
    ok('Your own look restores its style and keeps the width', S.mode === 'quad' && S.fg === '#123456' && S.cols === 90 && $$('.look[data-look="user:Selftest look"]').length === 1);
    deleteUserLook('Selftest look');
    ok('Your own look can be deleted', !userLooks.some(l => l.name === 'Selftest look') && !$('.look[data-look="user:Selftest look"]'));
    userLooks = JSON.parse(keep); storeUserLooks(); buildLooks(); Object.assign(S, saved);
  } catch (e) { ok('undo / looks: ' + e.message, false); }
  Object.assign(S, saved);
  try {   // ---- batch conversion ----
    const keepSrc = App.src, png = await new Promise(r => demoCanvas().toBlob(r, 'image/png')), keepDl = download; let zip = null;
    download = b => { zip = b; };
    try { await runBatch([new File([png], 'a.png', { type: 'image/png' }), new File(['hi'], 'b.txt', { type: 'text/plain' }), new File([new Uint8Array([1, 2, 3])], 'c.jpg', { type: 'image/jpeg' })], { png: true, txt: true }); } finally { download = keepDl; }
    const d = zip ? new Uint8Array(await zip.arrayBuffer()) : new Uint8Array(0), names = [];
    for (let p = 0; p + 30 < d.length && d[p] === 0x50 && d[p + 1] === 0x4b && d[p + 2] === 3 && d[p + 3] === 4;) { const n = d[p + 26] | d[p + 27] << 8, sz = d[p + 18] | d[p + 19] << 8 | d[p + 20] << 16 | d[p + 21] << 24; names.push(new TextDecoder().decode(d.subarray(p + 30, p + 30 + n))); p += 30 + n + sz; }
    ok(`Batch conversion: ${names.join(', ')}`, names.join() === `a_${S.mode}.png,a_${S.mode}.txt,b_text.png,b_text.txt,c_FAILED.txt` && App.src === keepSrc);
  } catch (e) { ok('batch: ' + e.message, false); }
  try {   // ---- painted mask ----
    const box = document.createElement('canvas'); box.width = 400; box.height = 300;
    { const g = box.getContext('2d'); g.fillStyle = '#30a0e0'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#ffe080'; g.beginPath(); g.arc(200, 150, 80, 0, 7); g.fill(); }
    setSource({ kind: 'image', bmp: await createImageBitmap(box), w: 400, h: 300, name: 'mask-test.png' });
    const St = Object.assign({}, S, { mode: 'braille', colorMode: 'mono', fg: '#ffffff', bg: '#000000', cols: 60, outline: 0, bgFade: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0, rotate: 0, flipH: false, flipV: false });
    const ink = (r, x0, x1) => { let on = 0; for (let y = 0; y < r.rows; y++) for (let x = Math.floor(x0 * r.cols); x < Math.floor(x1 * r.cols); x++) if (r.bits[y * r.cols + x]) on++; return on; };
    const s0 = convert(App.src.bmp, 400, 300, St);
    const m = maskEnsure(), mg = m.canvas.getContext('2d'); mg.fillStyle = '#f00'; mg.fillRect(0, 0, m.canvas.width / 2, m.canvas.height); m.ver++;
    const s1 = convert(App.src.bmp, 400, 300, St);
    ok(`Mask "hide": left half emptied (${ink(s0, 0, 0.45)} → ${ink(s1, 0, 0.45)} dots), right half unchanged`, ink(s0, 0, 0.45) > 50 && ink(s1, 0, 0.45) === 0 && ink(s1, 0.55, 1) === ink(s0, 0.55, 1));
    mg.clearRect(0, 0, m.canvas.width, m.canvas.height); mg.fillStyle = '#0f0'; mg.fillRect(0, 0, m.canvas.width, m.canvas.height); m.ver++;
    const kept = convert(App.src.bmp, 400, 300, Object.assign({}, St, { bgFade: 1 }));
    maskClear();
    const faded = convert(App.src.bmp, 400, 300, Object.assign({}, St, { bgFade: 1 }));
    ok(`Mask "keep" protects from "Hide plain background" (corner dots ${ink(faded, 0, 0.1)} without, ${ink(kept, 0, 0.1)} with)`, ink(faded, 0, 0.1) === 0 && ink(kept, 0, 0.1) > 20);
  } catch (e) { ok('mask: ' + e.message, false); }
  {   // ---- Text → Image options ----
    const St = Object.assign({}, S, { colorMode: 'gradient', gradA: '#000000', gradB: '#ffffff', textGradient: 'horizontal', margin: 2, fontSize: 10, charAspect: 2 });
    const r = textResult('abcd\nefgh', St);
    ok('Text gradient left → right', r.fg[0] === 255 && r.fg[3 * 3] === 0 && r.fg[4 * 3] === 255 && r.fg[7 * 3] === 0);
    const c = document.createElement('canvas'); renderResult(r, St, c, 1); const [cw, ch] = cellSize(St, 1);
    ok(`Margin adds space around the picture (${c.width}×${c.height})`, c.width === (4 + 4) * cw && c.height === (2 + 4) * ch && resultSVG(r, St).includes('translate('));
    ok('Custom font names are sanitised', fontCss({ fontFamily: 'custom', customFont: "Evil'; } x" }) === "'Evil  x', 'Segoe UI Symbol', monospace");
  }
  const tr = textResult('ab\n⣿⣿⣿', S); ok('text source grid', tr.cols === 3 && tr.rows === 2 && resultText(tr) === 'ab \n⣿⣿⣿');
  App.dirty = true;
  out.textContent = log.join('\n');
  document.title = (log.some(l => l.startsWith('FAIL')) ? 'SELFTEST FAIL' : 'SELFTEST PASS');
  console.log(log.join('\n'));
}

