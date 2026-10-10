/* =====================================================================
   Feature test (open index.html#uitest): the interactive features on a demo picture and synthetic files
   (overlay: captions + edits, ANSI import, gallery, crop, wipe, projects, ZIP, mask undo, palettes, emoji, effects…)
   ===================================================================== */
async function uiTest() {
  const out = $('#selftest'); out.hidden = false;
  const log = [], say = l => { log.push(l); out.textContent = log.join('\n'); };
  const ok = (name, cond, detail) => { say(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); return cond; };
  const saved = Object.assign({}, S);
  const reset = () => { Object.assign(S, DEFAULTS); editsClear(); syncControls(); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  try {
    reset();
    await demoImage(); await wait(50); renderNow();
    for (const t of UI_TESTS) {
      const t0 = performance.now();
      try { await t(ok, { reset, wait, say }); }
      catch (e) { console.error(e); ok(t.name + ' threw', false, e && e.message || e); }
      finally { const ms = performance.now() - t0; if (ms > 1000) say(`NOTE ${t.name} took ${(ms / 1000).toFixed(1)} s`); }
      reset();
    }
  } catch (e) { console.error(e); say('FAIL uiTest crashed: ' + (e && e.message || e)); }
  Object.assign(S, saved); syncControls();
  const fails = log.filter(l => l.startsWith('FAIL')).length;
  say(`${fails ? 'FAIL' : 'PASS'} ${log.length - fails} of ${log.length} feature checks`);
  document.title = fails ? 'UITEST FAIL' : 'UITEST PASS';
}
const UI_TESTS = [];
/* a still source result of the demo picture with settings St */
const uiDemoRes = St => { const c = demoCanvas(); return convert(c, c.width, c.height, St); };
const uiRow = (res, y) => { let s = ''; for (let x = 0; x < res.cols; x++) s += chr(res.cp[y * res.cols + x] || 32); return s; };

UI_TESTS.push(async function gallery(ok, { wait }) {
  await demoImage(); await wait(30); renderNow();
  const res0 = App.res, out = $('#outCanvas'), before = out.toDataURL();
  startPeek('Matrix'); await wait(220); renderNow();
  ok('Look preview: shown on the big picture', !!App.peek && out.toDataURL() !== before && !$('#peekBadge').hidden);
  ok('Look preview: your result (exports, sharing) is unchanged', App.res === res0 && S.mode === DEFAULTS.mode);
  endPeek(); renderNow();
  ok('Look preview: ends without changing anything', !App.peek && out.toDataURL() === before && $('#peekBadge').hidden);
  openGallery();
  const cards = $$('#galleryGrid .look');
  ok('Bigger gallery: a card for every look', cards.length === Object.keys(PRESETS).length + userLooks.length, cards.length + ' cards');
  await renderGallery();
  ok('Bigger gallery: every card is drawn', cards.every(c => c.querySelector('canvas').width > 100), cards[0].querySelector('canvas').width + 'px wide');
  cards[2].click();
  ok('Bigger gallery: click applies the look and closes', App.look === cards[2].dataset.look && !$('#galleryDialog').open);
});

/* pointer events on an element at fractions (fx, fy) of its box */
function uiPointer(el, type, fx, fy, target) {
  const b = el.getBoundingClientRect();
  (target || el).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: b.left + b.width * fx, clientY: b.top + b.height * fy }));
}
function uiDrag(el, a, b, steps = 4) {
  uiPointer(el, 'pointerdown', a[0], a[1]);
  for (let i = 1; i <= steps; i++) uiPointer(el, 'pointermove', a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, $('#stage'));
  uiPointer(el, 'pointerup', b[0], b[1], $('#stage'));
}
UI_TESTS.push(async function cropAndWipe(ok, { wait }) {
  await demoImage(); await wait(30); renderNow();
  // the view ↔ source mapping is exact for every turn and flip
  let worst = 0;
  for (const rotate of [0, 90, 180, 270]) for (const flipH of [false, true]) for (const flipV of [false, true]) {
    const St = Object.assign({}, DEFAULTS, { rotate, flipH, flipV }), W = rotate % 180 ? 640 : 960, H = rotate % 180 ? 960 : 640;
    for (const [x, y] of [[0, 0], [123, 456], [959, 1], [480, 320]]) { const v = sourceToView(x, y, W, H, 960, 640, St), s = viewToSource(v[0], v[1], W, H, 960, 640, St); worst = Math.max(worst, Math.abs(s[0] - x), Math.abs(s[1] - y)); }
  }
  ok('Crop box: picture ↔ view mapping is exact for every turn and flip', worst < 1e-6, 'max error ' + worst.toExponential(1));
  setCropMode(true); renderNow();
  const c = $('#srcCanvas');
  ok('Crop box: shows the whole picture next to the result', Crop.on && App.view === 'split' && Math.abs(c.width / c.height - 1.5) < 0.01, c.width + 'x' + c.height);
  uiDrag(c, [0.25, 0.2], [0.75, 0.6]);
  ok('Crop box: drawing a box sets the crop', Math.abs(S.cropL - 25) < 1 && Math.abs(S.cropR - 25) < 1 && Math.abs(S.cropT - 20) < 1 && Math.abs(S.cropB - 40) < 1, [S.cropL, S.cropR, S.cropT, S.cropB].join(' / '));
  uiDrag(c, [0.5, 0.4], [0.6, 0.5]);
  ok('Crop box: dragging inside moves it', Math.abs(S.cropL - 35) < 1.5 && Math.abs(S.cropR - 15) < 1.5 && Math.abs(S.cropT - 30) < 1.5, [S.cropL, S.cropR, S.cropT, S.cropB].join(' / '));
  uiDrag(c, [0.85, 0.5], [0.95, 0.5]);
  ok('Crop box: dragging the right edge resizes it', Math.abs(S.cropR - 5) < 1.5 && Math.abs(S.cropL - 35) < 1.5, [S.cropL, S.cropR].join(' / '));
  applySettings({ cropL: 0, cropR: 0, cropT: 0, cropB: 0, rotate: 90 }); renderNow();
  uiDrag(c, [0, 0], [0.5, 0.5]);
  ok('Crop box: works on a turned picture', S.cropL + S.cropR > 40 && S.cropT + S.cropB > 40 && S.cropL + S.cropR < 60, [S.cropL, S.cropR, S.cropT, S.cropB].join(' / '));
  setCropMode(false); applySettings({ cropL: 0, cropR: 0, cropT: 0, cropB: 0, rotate: 0 });
  ok('Crop box: done returns to the previous view', !Crop.on && App.view === 'out');
  setView('wipe'); renderNow(); await wait(30);
  const out = $('#outCanvas');
  ok('Wipe: the original lies exactly over the result', c.style.position === 'absolute' && c.style.left === out.offsetLeft + 'px' && c.style.width === out.offsetWidth + 'px' && c.width === out.width);
  uiDrag(out, [0.5, 0.5], [0.3, 0.5]);
  ok('Wipe: dragging moves the divider', Math.abs(Wipe.pos - 30) < 1 && /inset\(0(px)? 70/.test(c.style.clipPath), Wipe.pos.toFixed(1) + '% ' + c.style.clipPath);
  $('#wipeBar').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  ok('Wipe: arrow keys move the divider', Math.abs(Wipe.pos - 32) < 0.01);
  setView('out'); await wait(10);
  ok('Wipe: leaving puts the original back', c.style.position === '' && c.style.clipPath === '');
});

UI_TESTS.push(async function maskTools(ok, { wait }) {
  await demoImage(); await wait(30); renderNow();
  setMaskMode(true); renderNow();
  const c = $('#srcCanvas'), ink = () => { const m = Mask.canvas, d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i]; return s; };
  uiDrag(c, [0.3, 0.5], [0.6, 0.5]);
  const after1 = ink();
  ok('Mask: a stroke paints', after1 > 0 && MaskHist.undo.length === 1);
  uiDrag(c, [0.3, 0.2], [0.6, 0.2]);
  maskStep(true);
  ok('Mask undo: removes the last stroke only', ink() === after1);
  maskStep(true);
  ok('Mask undo: back to empty', ink() === 0 && !$('#maskRedo').disabled);
  maskStep(false);
  ok('Mask redo: the stroke comes back', ink() === after1);
  // hard brush: full strength up to the edge; soft: fades
  maskStep(true); Mask.hard = true; Mask.size = 10;
  uiDrag(c, [0.5, 0.5], [0.5, 0.5], 1);
  const m = Mask.canvas, k = m.width / c.width, cx = Math.round(m.width / 2), cy = Math.round(m.height / 2);
  const r = 10 / 100 * Math.max(m.width, m.height), at = f => m.getContext('2d').getImageData(Math.round(cx + r * f), cy, 1, 1).data[3];
  const hardEdge = at(0.88);
  maskStep(true); Mask.hard = false;
  uiDrag(c, [0.5, 0.5], [0.5, 0.5], 1);
  const softEdge = at(0.88);
  ok('Mask brush: hard edge is solid, soft edge fades', hardEdge > 240 && softEdge < 160, `hard ${hardEdge}, soft ${softEdge}`);
  $('#maskClearBtn').click(); maskStep(true);
  ok('Mask: clearing can be undone', ink() > 0);
  setMaskMode(false); Mask.size = 6;
});

/* runs fn while download() hands its files to the test instead of saving them */
async function uiCaptureDownloads(fn) {
  const got = [], real = window.download;
  window.download = (blob, name) => got.push({ blob, name });
  try { await fn(); } finally { window.download = real; }
  return got;
}
UI_TESTS.push(async function zipFiles(ok) {
  const enc = new TextEncoder(), text = enc.encode('hello text art '.repeat(400)), bin = synthPixels(40, 30, 5);
  const files = [{ name: 'a.txt', data: text }, { name: 'pics/b.png', data: bin.slice(0, 900) }, { name: 'c.bin', data: new Uint8Array(bin.buffer) }, { name: 'empty.txt', data: new Uint8Array(0) }];
  const z = await makeZipAsync(files), u = new Uint8Array(await z.arrayBuffer()), back = await readZip(u);
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  ok('ZIP: compressed files read back identical', files.every(f => back.has(f.name) && same(back.get(f.name), f.data)));
  ok('ZIP: text is compressed', u.length < text.length / 4 + bin.length + 2000, fmtBytes(u.length) + ' for ' + fmtBytes(text.length + bin.length * 2));
  const plain = await readZip(new Uint8Array(await makeZip(files).arrayBuffer()));
  ok('ZIP: uncompressed ZIPs read too', files.every(f => same(plain.get(f.name), f.data)));
  let bad = false; try { const d = u.slice(); d[40] ^= 0xff; await readZip(d); } catch (e) { bad = true; }
  ok('ZIP: damage is detected', bad);
});

UI_TESTS.push(async function projects(ok, { wait, reset }) {
  // a picture opened from a file (as users do): the project keeps the file, so it decodes exactly the same way
  await openFile(new File([await canvasToBlob(demoCanvas(), 'image/png')], 'sunset.png', { type: 'image/png' })); await wait(30);
  applySettings({ mode: 'ascii', cols: 77, cropL: 10, rotate: 90, colorMode: 'color', captionTop: 'MY TITLE', gamma: 1.4 });
  renderNow();
  setMaskMode(true); renderNow(); uiDrag($('#srcCanvas'), [0.2, 0.5], [0.8, 0.5]); setMaskMode(false);
  maskFlush(); renderNow();
  const r0 = App.res; Edits.cols = r0.cols; Edits.rows = r0.rows; Edits.cells.set(3, { cp: 0x263a, rgb: 0x00ff00 }); Edits.ver++;
  App.dirty = true; renderNow();
  const text0 = resultText(App.res), maskInk = () => { const m = Mask.canvas, d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i]; return s; }, ink0 = maskInk();
  const got = await uiCaptureDownloads(saveProject);
  ok('Project: saved as one .textart file', got.length === 1 && /\.textart$/.test(got[0].name), got[0] && got[0].name);
  reset(); await demoAnim(); await wait(30);
  ok('Project: (something else is open now)', App.src.kind === 'anim');
  await openProject(new File([got[0].blob], got[0].name));
  maskFlush(); App.dirty = true; renderNow();
  ok('Project: the picture is back', App.src.kind === 'image' && App.src.w === 960 && App.src.h === 640);
  ok('Project: every setting is back', S.mode === 'ascii' && S.cols === 77 && S.cropL === 10 && S.rotate === 90 && S.gamma === 1.4 && S.captionTop === 'MY TITLE');
  ok('Project: the mask is back', !!Mask.canvas && Math.abs(maskInk() - ink0) / ink0 < 0.02, maskInk() + ' vs ' + ink0);
  ok('Project: the hand edit is back', Edits.cells.get(3) && Edits.cells.get(3).cp === 0x263a);
  // the browser's GPU downscaling of the picture can round slightly differently from one moment to the next,
  // so the saved picture is compared pixel by pixel and the result only needs to match closely
  { const px = b => { const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(b, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const a = px(App.src.bmp), b = px(await createImageBitmap(demoCanvas())); let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    ok('Project: the picture is the same, pixel for pixel', d === 0, d + ' bytes differ');
    const t1 = resultText(App.res); let n = 0; for (let i = 0; i < Math.max(t1.length, text0.length); i++) if (t1[i] !== text0[i]) n++;
    ok('Project: the result matches', n / text0.length < 0.2, n ? `${n} of ${text0.length} characters differ (GPU resampling)` : 'identical'); }
  // an animation keeps its trim
  reset(); await demoAnim(); await wait(30); App.tin = 0.5; App.tout = 1.5;
  const g2 = await uiCaptureDownloads(saveProject);
  reset(); await demoImage();
  await openProject(new File([g2[0].blob], g2[0].name));
  ok('Project: an animation opens with its trim', App.src.kind === 'anim' && App.src.frames.length === 48 && App.tin === 0.5 && App.tout === 1.5);
  // coloured ANSI text
  reset(); openTextArt('\x1b[31mRED\x1b[0m \x1b[44mblue bg\x1b[0m', 'c.ans');
  const t0 = resultANSI(App.res = textResult(App.src.text, S, App.src.ansi));
  const g3 = await uiCaptureDownloads(saveProject);
  reset(); await demoImage();
  await openProject(new File([g3[0].blob], g3[0].name));
  ok('Project: coloured ANSI text opens with its colours', App.src.kind === 'text' && !!App.src.ansi && resultANSI(textResult(App.src.text, S, App.src.ansi)) === t0);
  const before = App.src;
  await openFile(new File([await makeZip([{ name: 'x.txt', data: new Uint8Array(5) }]).arrayBuffer()], 'other.zip'));
  ok('Project: an ordinary ZIP is refused, nothing changes', App.src === before);
  editsClear(); maskClear();
});

UI_TESTS.push(async function editing(ok, { wait }) {
  await demoImage(); await wait(30); applySettings({ mode: 'braille', cols: 60 }); renderNow();
  const out = $('#outCanvas'), res0 = App.res;
  setEditMode(true);
  ok('Edit: the edit bar opens on the result', Edit.on && !$('#editBar').hidden && App.view === 'out');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'X', bubbles: true }));
  ok('Edit: typing a key picks it as the brush', Edit.cp === 0x58 && $('#editChar').value === 'X');
  const at = (fx, fy) => { const b = out.getBoundingClientRect(); return cellAt({ clientX: b.left + b.width * fx, clientY: b.top + b.height * fy }); };
  const c1 = at(0.5, 0.5);
  uiDrag(out, [0.5, 0.5], [0.5, 0.5], 1); renderNow();
  ok('Edit: a click puts the character there', App.res.cp[c1.i] === 0x58 && Edits.cells.size === 1, 'cell ' + c1.x + ',' + c1.y);
  const a = at(0.2, 0.3), b = at(0.4, 0.3);
  uiDrag(out, [0.2, 0.3], [0.4, 0.3], 3); renderNow();
  let row = 0; for (let x = a.x; x <= b.x; x++) if (App.res.cp[a.y * App.res.cols + x] === 0x58) row++;
  ok('Edit: dragging paints every cell on the way', row === b.x - a.x + 1, row + ' of ' + (b.x - a.x + 1));
  Edit.tool = 'pick'; const p = at(0.8, 0.8); uiDrag(out, [0.8, 0.8], [0.8, 0.8], 1);
  ok('Edit: pick takes the character and colour', Edit.cp === (res0.cp[p.i] || 32) && Edit.rgb === cellRGB(res0, p.i) && Edit.tool === 'paint');
  Edit.tool = 'erase'; uiDrag(out, [0.5, 0.5], [0.5, 0.5], 1); renderNow();
  ok('Edit: erase brings the original back', App.res.cp[c1.i] === res0.cp[c1.i] && !Edits.cells.has(c1.i));
  editsStep(true); renderNow();
  ok('Edit: undo', App.res.cp[c1.i] === 0x58);
  editsStep(false); renderNow();
  ok('Edit: redo', App.res.cp[c1.i] === res0.cp[c1.i]);
  Edit.tool = 'paint'; Edit.keep = false; Edit.rgb = 0xff00ff; Edit.cp = 0x2665;
  uiDrag(out, [0.6, 0.6], [0.6, 0.6], 1); renderNow();
  const c2 = at(0.6, 0.6);
  ok('Edit: a new colour', cellRGB(App.res, c2.i) === 0xff00ff && App.res.cp[c2.i] === 0x2665);
  const n = Edits.cells.size, png = out.toDataURL();
  applySettings({ cols: 70 }); renderNow();
  ok('Edit: hidden at another width, with a warning', !App.res.ov && $('#editInfo').classList.contains('warn'));
  uiDrag(out, [0.1, 0.1], [0.1, 0.1], 1);
  ok('Edit: no painting at another width', Edits.cells.size === n);
  applySettings({ cols: 60 }); renderNow();
  ok('Edit: back at the width, the edits are back', App.res.cp[c2.i] === 0x2665 && out.toDataURL() === png);
  const gif = await gifBytes(() => {}), frames = decodeGIF(gifBytes.length ? gif.buffer : gif.buffer);
  ok('Edit: saved pictures include the edits', frames.frames.length >= 1);
  // hover
  setEditMode(false);
  uiPointer(out, 'pointermove', 0.6, 0.6, out);
  ok('Hover: shows the character and colour under the pointer', /U\+2665 · #ff00ff · column \d+, row \d+ · edited/.test($('#cellInfo').textContent), $('#cellInfo').textContent);
  ok('Hover: the floating tip only in Advanced or while editing', $('#cellTip').hidden);
  setAdvanced(true); uiPointer(out, 'pointermove', 0.6, 0.6, out);
  ok('Hover: floating tip in Advanced', !$('#cellTip').hidden && $('#cellTip').textContent.includes('U+2665'));
  setAdvanced(false); $('#stage').dispatchEvent(new PointerEvent('pointerleave'));
  editsClear();
});

UI_TESTS.push(async function captionControls(ok, { wait }) {
  await demoImage(); await wait(30); applySettings({ mode: 'ascii', cols: 70 }); renderNow();
  const top = $('#capTop'); top.value = 'SUMMER 2026'; top.dispatchEvent(new Event('input', { bubbles: true })); renderNow();
  ok('Caption field: typing writes it on the picture', S.captionTop === 'SUMMER 2026' && uiRow(App.res, 1).includes('SUMMER 2026'));
  $('#capStyle').value = 'big'; $('#capStyle').dispatchEvent(new Event('change', { bubbles: true })); renderNow();
  ok('Caption field: big letters', S.captionStyle === 'big' && !uiRow(App.res, 1).includes('SUMMER'));
  History.step(true); History.step(true); renderNow();
  ok('Caption field: undo works', S.captionTop === '' || S.captionStyle === 'plain');
});

UI_TESTS.push(async function retroPalettes(ok) {
  const gb = RETRO_PALETTES.gameboy.cols, key = c => c.join();
  ok('Retro: Game Boy maps by brightness (black → darkest, white → lightest)', key(appColour('gameboy', 0, 0, 0)) === key(gb[0]) && key(appColour('gameboy', 255, 255, 255)) === key(gb[3]));
  ok('Retro: C64 red is the C64 red', key(appColour('c64', 140, 0, 0)) === '136,0,0');
  const St = Object.assign({}, DEFAULTS, { mode: 'half', colorMode: 'app', appPalette: 'pico8', cols: 50 }), r = uiDemoRes(St);
  const allowed = new Set(RETRO_PALETTES.pico8.cols.map(key)); let bad = 0;
  for (let i = 0; i < r.fg.length; i += 3) { if (!allowed.has(r.fg[i] + ',' + r.fg[i + 1] + ',' + r.fg[i + 2])) bad++; if (!allowed.has(r.bgc[i] + ',' + r.bgc[i + 1] + ',' + r.bgc[i + 2])) bad++; }
  ok('Retro: every pixel uses the palette', bad === 0, bad + ' outside');
  ok('Retro: looks in the gallery', ['Game Boy', 'Commodore 64', 'Amber terminal'].every(n => $(`#looks .look[data-look="${n}"]`)));
  ok('Retro: palettes in the colour menu', $$('[data-key="appPalette"] option').length >= 9);
});

UI_TESTS.push(async function emojiMosaic(ok) {
  const St = Object.assign({}, DEFAULTS, { mode: 'emoji', colorMode: 'color', cols: 41, bg: '#ffffff' }), c = demoCanvas();
  const T = emojiTable('blocks', '#ffffff');
  ok('Emoji: colours measured for the set', T.cps.length >= 20, T.cps.length + ' emoji');
  const r = convertRaw(c, c.width, c.height, St);
  let pairs = 0, bad = 0;
  for (let y = 0; y < r.rows; y++) for (let x = 0; x + 1 < r.cols; x += 2) {
    const a = r.cp[y * r.cols + x], b = r.cp[y * r.cols + x + 1];
    if (a === 32 && b === 32) continue;
    if (T.cps.includes(a) && b === WIDE_CONT) pairs++; else bad++;
  }
  ok('Emoji: every emoji fills two columns', pairs > 200 && bad === 0, `${pairs} emoji, ${bad} bad cells`);
  ok('Emoji: odd last column stays empty', r.cp[r.cols - 1] === 32);
  const t = resultText(r), lines = t.split('\n');
  ok('Emoji: text has no hidden marker characters', !t.includes(String.fromCodePoint(WIDE_CONT)) && lines.every(l => Array.from(l).length <= 21), Array.from(lines[0]).length + ' per line');
  ok('Emoji: square cells (rows follow two columns per emoji)', Math.abs(r.rows - Math.round(41 * (640 / 960) / 2)) <= 1, r.cols + 'x' + r.rows);
  const red = nearestEmoji(T, 220, 30, 30);
  ok('Emoji: red picks a red emoji', [0x1f7e5, 0x1f534].includes(red), chr(red));
  if (Pool.size()) {
    const pre = convertInputs(c, c.width, c.height, St), w = await Pool.run('convertPre', { pre, sw: c.width, sh: c.height, St });
    ok('Emoji: a worker gives the same mosaic', w.cp.every((v, i) => v === r.cp[i]));
  }
  const svg = resultSVG(r, St), html = resultHTMLInner(r), cv = document.createElement('canvas'); renderResult(r, St, cv, 1);
  ok('Emoji: SVG and HTML have the emoji, picture is drawn', svg.includes(chr(r.cp.find(v => v > 0x2000 && v !== WIDE_CONT))) && !html.includes(String.fromCodePoint(WIDE_CONT)) && cv.width > 100);
  const res2 = withOverlay(r, Object.assign({}, St, { captionTop: 'HI' }));
  ok('Emoji: captions on an emoji mosaic', resultText(res2).includes('HI'));
});

UI_TESTS.push(async function effects(ok, { wait }) {
  await demoImage(); await wait(30); renderNow();
  ok('Effects: offered for a still picture', getComputedStyle($('.fx-only')).display !== 'none');
  const kinds = Object.keys(EFFECTS);
  for (const kind of kinds) {
    const a = await makeEffectAnim(kind, { seconds: 2 }, null, true);
    const px = i => { const c = document.createElement('canvas'); c.width = a.w; c.height = a.h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(a.frames[i].bmp, 0, 0); return g.getImageData(0, 0, a.w, a.h).data; };
    const f0 = px(0), f1 = px(Math.floor(a.frames.length / 2)); let d = 0; for (let i = 0; i < f0.length; i += 4) if (f0[i] !== f1[i]) d++;
    ok(`Effect ${kind}: an animation that changes`, App.src === a && a.kind === 'anim' && a.frames.length === 30 && d > 100, `${a.frames.length} frames, ${d} pixels differ`);
    if (kind !== kinds[kinds.length - 1]) await backToStillWait();
  }
  ok('Effects: the animation offers "back to the still picture"', !$('#fxBack').hidden && document.body.hasAttribute('data-fx'));
  App.time = App.src.frames[20].t0; App.dirty = true; renderNow();
  const r20 = App.res; App.time = 0; App.dirty = true; renderNow();
  ok('Effects: frames convert differently', resultText(r20) !== resultText(App.res));
  const bytes = await gifBytes(() => {}), g = decodeGIF(bytes.buffer);
  ok('Effects: saves as an animated GIF', g.frames.length === 30, g.frames.length + ' frames');
  const got = await uiCaptureDownloads(saveProject);
  await demoAnim(); await openProject(new File([got[0].blob], got[0].name));
  ok('Effects: a project keeps the effect', App.src.effect && App.src.effect.kind === kinds[kinds.length - 1] && App.src.frames.length === 30);
  await backToStillWait();
  ok('Effects: back to the still picture', App.src.kind === 'image' && App.src.w === 960 && !document.body.hasAttribute('data-fx'));
});
async function backToStillWait() { backToStill(); for (let i = 0; i < 50 && App.src.kind !== 'image'; i++) await new Promise(r => setTimeout(r, 20)); }

UI_TESTS.push(async function guides(ok, { wait }) {
  await demoImage(); await wait(30);
  applySettings({ mode: 'ascii', charset: 'standard' }); renderNow();
  const strip = $('#rampStrip');
  ok('Ramp strip: the characters from light to dense', !strip.hidden && strip.textContent.replace(/\u00a0/g, ' ') === CHARSETS.standard.chars, JSON.stringify(strip.textContent));
  applySettings({ charset: 'blocks', fg: '#ff0000' });
  ok('Ramp strip: follows the character set and colours', strip.textContent.includes('▓') && strip.style.color === 'rgb(255, 0, 0)');
  applySettings({ mode: 'braille' });
  ok('Ramp strip: hidden where there is no ramp', strip.hidden);
  // histogram numbers: a picture that is half black, half white
  const px = new Uint8ClampedArray(100 * 4); for (let i = 0; i < 100; i++) { const v = i < 50 ? 0 : 255; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; }
  const h0 = toneHistogram(px, Object.assign({}, DEFAULTS));
  ok('Histogram: counts pure black and white', Math.abs(h0.black - 0.5) < 1e-9 && Math.abs(h0.white - 0.5) < 1e-9 && h0.before[0] === 50 && h0.before[63] === 50);
  const mid = new Uint8ClampedArray(4).fill(128); mid[3] = 255;
  const hb = toneHistogram(mid, Object.assign({}, DEFAULTS, { brightness: 0.3 }));
  ok('Histogram: brightness moves the line right', hb.after.findIndex(v => v > 0) > hb.before.findIndex(v => v > 0));
  // the histogram follows the engine: same brightness as the conversion's internal tone curve
  const St = Object.assign({}, DEFAULTS, { gamma: 1.7, contrast: 0.2, saturation: 1.5 }), g = toneHistogram(px, St);
  ok('Histogram: other settings work', g.count === 100);
  setTab('adjust'); applySettings({ brightness: 0.2 }); await wait(250);
  ok('Histogram: drawn in the Adjust tab with a note', $('#toneHist').width > 50 && /pure black/.test($('#toneInfo').textContent), $('#toneInfo').textContent);
  setTab('look');
});

UI_TESTS.push(async function touchAndSheets(ok, { wait }) {
  await demoImage(); await wait(30); renderNow();
  setSheet('settings');
  ok('Sheets: settings opens', document.body.classList.contains('sheet-settings') && $('#mbSettings').getAttribute('aria-expanded') === 'true');
  setSheet('export');
  ok('Sheets: only one open at a time', !document.body.classList.contains('sheet-settings') && document.body.classList.contains('sheet-export'));
  setSheet(null);
  const out = $('#outCanvas'), stage = $('#stage'), b = out.getBoundingClientRect();
  const touch = (type, id, x, y, el) => (el || out).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  touch('pointerdown', 1, cx + 80, cy); touch('pointermove', 1, cx, cy, stage); touch('pointerup', 1, cx - 80, cy, stage);
  ok('Swipe left: shows the original', App.view === 'src');
  touch('pointerdown', 1, cx - 80, cy); touch('pointerup', 1, cx + 80, cy, stage);
  ok('Swipe right: back to the result', App.view === 'out');
  const start = currentScaleForZoom();
  touch('pointerdown', 1, cx - 30, cy); touch('pointerdown', 2, cx + 30, cy);
  touch('pointermove', 2, cx + 120, cy, stage); touch('pointermove', 1, cx - 120, cy, stage);
  touch('pointerup', 1, cx - 120, cy, stage); touch('pointerup', 2, cx + 120, cy, stage);
  const z = App.zoom;
  ok('Pinch: two fingers spread 4× zoom in 4×', Math.abs(z / start - 4) < 0.05, `zoom ${start.toFixed(2)} → ${z.toFixed(2)}`);
  App.zoom = 0; applyZoom();
  touch('pointerdown', 1, cx, cy); touch('pointerup', 1, cx, cy, stage); touch('pointerdown', 1, cx, cy); touch('pointerup', 1, cx, cy, stage);
  ok('Double-tap: zooms in', App.zoom === 2);
  touch('pointerdown', 1, cx, cy); touch('pointerup', 1, cx, cy, stage); touch('pointerdown', 1, cx, cy); touch('pointerup', 1, cx, cy, stage);
  ok('Double-tap again: back to fit', App.zoom === 0 && Touch.pts.size === 0);
  setSheet('settings'); touch('pointerdown', 1, cx, cy); touch('pointerup', 1, cx, cy, stage);
  ok('Tap on the picture closes the sheet', !sheetOpen());
  applyZoom();
});

UI_TESTS.push(async function accessibility(ok) {
  const nameOf = el => el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') && $('#' + el.getAttribute('aria-labelledby'))?.textContent) ||
    (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) || el.closest('label')?.textContent || (el.tagName === 'BUTTON' ? el.textContent : '') || '';
  const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const unnamed = $$('input:not([type=hidden]):not([type=file]), select, textarea, button').filter(el => visible(el) && !nameOf(el).trim());
  ok('Accessibility: every visible control has a name', unnamed.length === 0, unnamed.slice(0, 4).map(e => e.outerHTML.slice(0, 70)).join(' | '));
  ok('Accessibility: toggles say whether they are on', $$('.mode').every(b => b.getAttribute('aria-pressed') === String(b.classList.contains('on'))) && $$('#viewSeg button').some(b => b.getAttribute('aria-pressed') === 'true'));
  setTab('colour');
  ok('Accessibility: tabs say which one is open', $('#tabbtn-colour').getAttribute('aria-selected') === 'true' && $('#tabbtn-look').getAttribute('aria-selected') === 'false' && $('#tabbtn-look').tabIndex === -1);
  $('#tabbtn-colour').focus(); $('#leftTabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  ok('Accessibility: arrow keys move between tabs', $('#tabbtn-crop').getAttribute('aria-selected') === 'true' && document.activeElement === $('#tabbtn-crop'));
  setTab('look');
  ok('Accessibility: the Advanced switch can be reached by keyboard', getComputedStyle($('#advToggle')).display !== 'none');
  const bad = [];
  for (const theme of ['dark', 'light']) {
    document.documentElement.dataset.theme = theme;
    const v = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    for (const [fg, bg] of [['--text', '--bg'], ['--text', '--panel'], ['--text', '--panel-2'], ['--muted', '--panel'], ['--muted', '--panel-2'], ['--accent-text', '--panel'], ['--accent-text', '--panel-2'], ['--accent-ink', '--accent'], ['--danger', '--panel'], ['--warn', '--panel'], ['--warn', '--panel-2']]) {
      const r = contrastRatio(v(fg), v(bg)); if (r < 4.5) bad.push(`${theme} ${fg} on ${bg}: ${r.toFixed(2)}`);
    }
  }
  document.documentElement.removeAttribute('data-theme');
  ok('Accessibility: text contrast at least 4.5:1 in every theme', bad.length === 0, bad.join('; '));
});

UI_TESTS.push(async function shareSheet(ok, { wait }) {
  const shared = [], realShare = navigator.share, realCan = navigator.canShare;
  Object.defineProperty(navigator, 'share', { configurable: true, value: async d => { shared.push(d); } });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  try {
    await demoImage(); await wait(30); renderNow(); buildExportPanel(); S.exportGoal = 'save'; applyGoal();
    const b = $$('#exportBody button').find(x => x.textContent === 'Share…');
    ok('Share: a Share button for the picture', !!b);
    await actSharePicture();
    ok('Share: sends a PNG file', shared.length === 1 && shared[0].files[0].type === 'image/png' && shared[0].files[0].size > 1000);
    await actShareText();
    ok('Share: sends the chat text', shared.length === 2 && typeof shared[1].text === 'string' && shared[1].text.length > 50);
    await demoAnim(); await wait(30); buildExportPanel();
    ok('Share: a Share GIF button for animations', $$('#exportBody button').some(x => x.textContent === 'Share GIF…'));
    ok('Installable app: nothing is installed or cached when opened as a file', location.protocol !== 'file:' || !document.querySelector('link[rel=manifest]'));
  } finally {
    if (realShare) Object.defineProperty(navigator, 'share', { configurable: true, value: realShare }); else delete navigator.share;
    if (realCan) Object.defineProperty(navigator, 'canShare', { configurable: true, value: realCan }); else delete navigator.canShare;
    S.exportGoal = 'chat'; buildExportPanel();
  }
});

UI_TESTS.push(async function captions(ok) {
  const bmp = await createImageBitmap(demoCanvas()), W = bmp.width, H = bmp.height;
  const St = Object.assign({}, DEFAULTS, { mode: 'ascii', cols: 60, captionTop: 'HELLO THERE', captionBottom: 'bottom line' });
  const r = convert(bmp, W, H, St), raw = convertRaw(bmp, W, H, St);
  ok('Caption: top line written in characters', uiRow(r, 1).includes('HELLO THERE'), uiRow(r, 1).trim());
  ok('Caption: bottom line written in characters', uiRow(r, r.rows - 2).includes('bottom line'));
  ok('Caption: the cached conversion is left unchanged', !raw.ov && raw !== r && !uiRow(raw, 1).includes('HELLO'));
  ok('Caption: overlaid result is reused (no recompute)', convert(bmp, W, H, St) === r);
  const Sb = Object.assign({}, St, { mode: 'braille', captionStyle: 'big', captionBottom: '' }), rb = convert(bmp, W, H, Sb);
  let lit = 0; for (let y = 1; y < 1 + Math.round(rb.rows * 0.2); y++) for (let x = 0; x < rb.cols; x++) if (rb.bits[y * rb.cols + x] === 0xff) lit++;
  ok('Big caption: drawn with the style\'s own dots', lit > 20, lit + ' full cells');
  // the same frame drawn on a worker (converted there, overlay sent along) equals the frame drawn here
  if (Pool.size()) {
    clearEngineCaches();
    const Sw = Object.assign({}, St, { mode: 'braille', renderStyle: 'shapes' });
    const a = frameJobArgs({ d: bmp, w: W, h: H }, Sw);
    const local = withOverlay(convertCore(null, W, H, Sw, null, a.pre), Sw);
    const c = document.createElement('canvas'); c.getContext('2d', { willReadFrequently: true }); renderResult(local, Sw, c, 1);   // drawn like exports (CPU canvas)
    Object.assign(a, { St: Sw, scale: 1, w: c.width, h: c.height });
    const px = await Pool.run('renderFrame', a), mine = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let diff = 0; for (let i = 0; i < px.length; i++) if (px[i] !== mine[i]) diff++;
    ok('Caption on a worker-converted frame matches this thread', !!a.ov && diff === 0, diff + ' bytes differ');
  }
  const t = textResult('line one\nline two', Object.assign({}, St, { captionTop: '', captionBottom: 'X' }));
  ok('Caption on text art', resultText(t).includes('X'));
  bmp.close();
});

UI_TESTS.push(async function edits(ok) {
  const St = Object.assign({}, DEFAULTS, { mode: 'braille', cols: 40 }), base = uiDemoRes(St);
  Edits.cols = base.cols; Edits.rows = base.rows; Edits.cells.set(5, { cp: 0x41, rgb: 0xff0000 }); Edits.ver++;
  const r = uiDemoRes(St);
  ok('Edit: the cell shows the new character', r.cp[5] === 0x41 && r.ov[5] === 1 && r.bits[5] === 0);
  ok('Edit: the cell has the new colour', r.fg[15] === 255 && r.fg[16] === 0 && !r.uniform);
  const other = uiDemoRes(Object.assign({}, St, { cols: 41 }));
  ok('Edit: not applied at another width', !other.ov || other.cp[5] !== 0x41);
  const svg = resultSVG(r, St);
  ok('Edit: present in SVG', svg.includes('>A<'));
  editsClear();
});

UI_TESTS.push(async function ansiImport(ok) {
  const esc = '\x1b[';
  const src = `${esc}31mR${esc}0m ${esc}1;32mG${esc}0m\n${esc}38;2;10;20;30;48;5;196mT${esc}0m${esc}2Cx`;
  const a = ansiParse(src, 0);
  ok('ANSI: grid size', a.cols === 4 && a.rows === 2, a.cols + 'x' + a.rows);
  ok('ANSI: 16 colours', a.fg[0] === 0xaa0000 && a.fg[2] === 0x55ff55, a.fg[0].toString(16) + ' ' + a.fg[2].toString(16));
  ok('ANSI: 24-bit foreground, 256-colour background', a.fg[4] === 0x0a141e && a.bg[4] === 0xff0000, a.bg[4].toString(16));
  ok('ANSI: cursor forward keeps spaces', a.cp[7] === 0x78 && a.cp[5] === 32 && a.cp[6] === 32);
  const u = decodeTextArt(new TextEncoder().encode(`${esc}35m█▓ test${esc}0m`), 'ans');
  ok('ANSI: UTF-8 file stays UTF-8', u.ansi && u.ansi.cp[0] === 0x2588 && u.text === '█▓ test', JSON.stringify(u.text));
  // CP437 bytes with a SAUCE record
  const bytes = new Uint8Array([0x1b, 0x5b, 0x33, 0x34, 0x6d, 0xdb, 0xb0, 0x0d, 0x0a, 0x41, 0x1a, 0x53, 0x41, 0x55, 0x43, 0x45]);
  const d = decodeTextArt(bytes, 'ans');
  ok('ANSI: CP437 blocks decoded, SAUCE cut', d.ansi && d.ansi.cp[0] === 0x2588 && d.ansi.cp[1] === 0x2591 && d.text === '█░\nA', JSON.stringify(d.text));
  ok('CP437 table has 128 characters', Array.from(CP437_HIGH).length === 128);
  // round trip: our own ANSI export opens with the same characters and colours
  const St = Object.assign({}, DEFAULTS, { mode: 'ascii', colorMode: 'color', cols: 50, bgMode: 'cell' }), r = convertRaw(demoCanvas(), 960, 640, St);
  const back = decodeTextArt(new TextEncoder().encode(resultANSI(r)), 'txt'), rr = ansiResult(back.ansi, St);
  let same = rr.cols === r.cols && rr.rows === r.rows;
  for (let i = 0; same && i < r.cp.length; i++) if (rr.cp[i] !== (r.cp[i] || 32)) same = false;
  for (let i = 0; same && i < r.fg.length; i++) if (rr.fg[i] !== r.fg[i] || rr.bgc[i] !== r.bgc[i]) same = false;
  ok('ANSI: own true-colour export opens identical (characters, text and cell colours)', same);
  const g = ansiResult(back.ansi, Object.assign({}, St, { colorMode: 'gray' }));
  ok('ANSI: re-coloured to greyscale', g.fg[0] === g.fg[1] && g.fg[1] === g.fg[2]);
  openTextArt(src, 'test.txt');
  ok('ANSI: pasted escape codes open as a coloured source', App.src && App.src.kind === 'text' && !!App.src.ansi && S.colorMode === 'color');
});
