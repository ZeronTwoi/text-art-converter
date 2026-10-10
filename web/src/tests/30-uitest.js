/* =====================================================================
   Feature test (open test.html#uitest): the interactive features on a demo picture and synthetic files
   (overlay: captions + edits, ANSI import, gallery, crop, wipe, projects, ZIP, mask undo, palettes, emoji, effects…)
   ===================================================================== */
async function uiTest() {
  const out = $('#selftest'); out.hidden = false;
  const log = [], say = l => { log.push(l); out.textContent = log.join('\n'); };
  const ok = (name, cond, detail) => { say(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`); return cond; };
  const saved = Object.assign({}, S);
  const reset = () => { Object.assign(S, DEFAULTS); editsClear(); if (Present.on) setPresent(false); syncControls(); };
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
  ok('No background job failed (workers do every job they are given)', Pool.failures.length === 0, Pool.failures.slice(0, 3).join(' | '));
  const fails = log.filter(l => l.startsWith('FAIL')).length;
  const checks = log.filter(l => /^(PASS|FAIL) /.test(l)).length;   // timing notes are not checks
  say(`${fails ? 'FAIL' : 'PASS'} ${checks - fails} of ${checks} feature checks`);
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
  // a playing animation in Compare and Text view keeps moving while a look is previewed
  await demoAnim(); await wait(30); setPlaying(false); setView('split'); renderNow();
  startPeek('Matrix'); await wait(220);
  const src = $('#srcCanvas'), frame = () => src.toDataURL();
  App.time = App.src.frames[5].t0; App.dirty = true; renderNow(); const a = frame(), resA = App.res;
  App.time = App.src.frames[20].t0; App.dirty = true; renderNow(); const b = frame();
  ok('Look preview: the original keeps playing in Compare view', a !== b && App.res === resA);
  setView('text'); renderNow(); const t1 = $('#rawText').textContent;
  App.time = App.src.frames[30].t0; App.dirty = true; renderNow();
  ok('Look preview: the Text view shows the previewed look and keeps playing', $('#rawText').textContent !== t1 && /[ｦ-ﾝ]/.test($('#rawText').textContent));
  endPeek(); setView('out'); await demoImage(); await wait(30); renderNow();
  ok('Look preview: ends without changing anything', !App.peek && out.toDataURL() === before && $('#peekBadge').hidden);
  openGallery();
  const cards = $$('#galleryGrid .look');
  ok('Bigger gallery: a card for every look', cards.length === Object.keys(PRESETS).length + userLooks.length, cards.length + ' cards');
  await renderGallery(); await wait(400);
  ok('Bigger gallery: every card is drawn', cards.every(c => c.querySelector('canvas').width > 100), cards[0].querySelector('canvas').width + 'px wide');
  cards[2].click();
  ok('Bigger gallery: click applies the look and closes', App.look === cards[2].dataset.look && !$('#galleryDialog').open);
  // the bigger previews show exactly what applying gives: your width, crop, captions
  applySettings({ cols: 64, cropL: 20, captionBottom: 'MY TEXT' }); openGallery(); await renderGallery(); await wait(500);
  const card = $$('#galleryGrid .look').find(c => c.dataset.look === 'Matrix'), shown = card._res;
  card.click(); renderNow();
  ok('Bigger gallery: a preview is exactly the result you get', !!shown && resultText(shown) === resultText(App.res) && resultText(shown).includes('MY TEXT'), shown && `${shown.cols}×${shown.rows}`);
  applySettings({ cols: DEFAULTS.cols, cropL: 0, captionBottom: '' });
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
  { const px = b => { const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(b, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const a = px(App.src.bmp), b = px(await createImageBitmap(demoCanvas())); let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    ok('Project: the picture is the same, pixel for pixel', d === 0, d + ' bytes differ');
    const t1 = resultText(App.res); let n = 0; for (let i = 0; i < Math.max(t1.length, text0.length); i++) if (t1[i] !== text0[i]) n++;
    ok('Project: the result is exactly the same', n === 0, n + ' characters differ'); }
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

UI_TESTS.push(async function editorMore(ok, { wait }) {
  await demoImage(); await wait(30); applySettings({ mode: 'ascii', cols: 60 }); renderNow(); editsClear();
  const out = $('#outCanvas'), at = (fx, fy) => { const b = out.getBoundingClientRect(); return cellAt({ clientX: b.left + b.width * fx, clientY: b.top + b.height * fy }); };
  const key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  setEditMode(true); Edit.tool = 'type'; updateEditUI();
  uiDrag(out, [0.1, 0.5], [0.1, 0.5], 1); const c0 = at(0.1, 0.5);
  for (const k of 'Hi there') key(k); key('Enter'); key('A'); key('B'); key('Backspace'); renderNow();
  const row = y => uiRow(App.res, y);
  ok('Type: text goes in at the cursor', row(c0.y).slice(c0.x, c0.x + 8) === 'Hi there', JSON.stringify(row(c0.y).slice(c0.x, c0.x + 8)));
  ok('Type: Enter goes to the next line, Backspace removes a letter', row(c0.y + 1)[c0.x] === 'A' && !Edits.cells.has((c0.y + 1) * App.res.cols + c0.x + 1));
  ok('Type: overlay cursor shown', !$('#editCursor').hidden);
  editsStep(true); renderNow();
  ok('Type: a burst of typing is one undo step', !row(c0.y).includes('Hi there'), Edits.cells.size + ' left');
  editsClear(); editsChanged(); renderNow();
  Edit.tool = 'select'; updateEditUI();
  const s0 = at(0.2, 0.2), s1 = at(0.4, 0.3);
  uiDrag(out, [0.2, 0.2], [0.4, 0.3]);
  const r = selNorm(Edit.sel);
  ok('Select: drag makes a box', r && r.x0 === s0.x && r.y1 === s1.y && !$('#editSel').hidden);
  const before = []; for (let y = r.y0; y <= r.y1; y++) before.push(row(y).slice(r.x0, r.x1 + 1));
  Edit.cp = 0x23; selFill(); renderNow();
  ok('Select: fill the box', row(r.y0).slice(r.x0, r.x1 + 1) === '#'.repeat(r.x1 - r.x0 + 1));
  editsStep(true); renderNow();
  key('ArrowRight'); key('ArrowRight'); renderNow();
  let moved = true; for (let y = r.y0; y <= r.y1; y++) if (row(y).slice(r.x0 + 2, r.x1 + 3) !== before[y - r.y0]) moved = false;
  ok('Select: arrow keys move the box', moved && row(r.y0).slice(r.x0, r.x0 + 2).trim() === '');
  selCopy(false); Edit.sel = null; Edit.cursor = { x: 0, y: 0, x0: 0 }; editPaste(null); renderNow();
  ok('Select: copy and paste', row(0).slice(0, r.x1 - r.x0 + 1) === before[0]);
  ok('Select: copied text on the clipboard object', Edit.clip.text.split('\n')[0] === before[0]);
  editsClear(); editsChanged(); renderNow();
  Edit.sel = { ax: 2, ay: 2, bx: 8, by: 6 }; selClear(true); renderNow();   // an empty 7 × 5 area
  Edit.tool = 'fill'; Edit.cp = 0x2a; updateEditUI();
  const cv = $('#outCanvas'), bb = cv.getBoundingClientRect(), [cw, chh] = cellSize(S, 1), k = bb.width / cv.width;
  uiPointer(cv, 'pointerdown', (5.5 * cw * k) / bb.width, (4.5 * chh * k) / bb.height); uiPointer(cv, 'pointerup', 0, 0, $('#stage')); renderNow();
  let filled = 0; for (let y = 2; y <= 6; y++) for (let x = 2; x <= 8; x++) if (App.res.cp[y * App.res.cols + x] === 0x2a) filled++;
  ok('Fill: the empty area becomes the brush', filled === 35, filled + ' of 35');
  setEditMode(false); editsClear();
});

UI_TESTS.push(async function captionControls(ok, { wait }) {
  await demoImage(); await wait(30); applySettings({ mode: 'ascii', cols: 70 }); renderNow();
  const top = $('#capTop'); top.value = 'SUMMER 2026'; top.dispatchEvent(new Event('input', { bubbles: true })); renderNow();
  ok('Caption field: typing writes it on the picture', S.captionTop === 'SUMMER 2026' && uiRow(App.res, 1).includes('SUMMER 2026'));
  $('#capStyle').value = 'big'; $('#capStyle').dispatchEvent(new Event('change', { bubbles: true })); renderNow();
  ok('Caption field: big letters', S.captionStyle === 'big' && !uiRow(App.res, 1).includes('SUMMER'));
  UndoHistory.step(true); UndoHistory.step(true); renderNow();
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
  ok('Double-tap again: back to fit', App.zoom === 0 && TouchState.pts.size === 0);
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

UI_TESTS.push(async function sameResultEverywhere(ok) {
  // one picture must convert the same however it arrived: opened file, demo canvas, GIF frame, pasted bitmap
  const W = 800, H = 500, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.drawImage(demoCanvas(), 0, 0, W, H);
  const id = g.getImageData(0, 0, W, H); for (let i = 0; i < id.data.length; i += 4) { const n = (hashNoise(i >> 2, 9) - 0.5) * 50; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] -= n; } g.putImageData(id, 0, 0);
  const png = await canvasToBlob(c, 'image/png'), hash = x => { let h = 2166136261; for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x[i], 16777619); return h >>> 0; };
  const opened = (await loadImageFile(new File([png], 'p.png', { type: 'image/png' }), 'png', 'png')).bmp;
  const sources = { 'opened file': opened, 'canvas': c, 'canvas bitmap': await createImageBitmap(c) };
  const results = {};
  for (const [name, s] of Object.entries(sources)) {
    const r = [];
    for (const St of [Object.assign({}, DEFAULTS, { cols: 100 }), Object.assign({}, DEFAULTS, { cols: 47, rotate: 270, cropT: 12, mode: 'quad', colorMode: 'color' })]) { clearEngineCaches(); const p = convertInputs(s, W, H, St); r.push(hash(p.sample), p.hi ? hash(p.hi) : 0); }
    results[name] = r.join();
  }
  const distinct = new Set(Object.values(results)).size;
  ok('Same result however a picture is opened (file, canvas, bitmap)', distinct === 1, distinct + ' different results');
  opened.close();
});

UI_TESTS.push(async function sessionRestore(ok, { wait, reset }) {
  await openFile(new File([await canvasToBlob(demoCanvas(), 'image/png')], 'beach.png', { type: 'image/png' })); await wait(30);
  applySettings({ mode: 'quad', cols: 66, colorMode: 'color', captionBottom: 'hello' }); renderNow();
  const r0 = App.res, Edit0 = r0.cols; Edits.cols = r0.cols; Edits.rows = r0.rows; Edits.cells.set(7, { cp: 0x40, rgb: null }); Edits.ver++;
  App.dirty = true; renderNow(); const text0 = resultText(App.res);
  await sessionSave();
  applySettings({ cols: 30, captionBottom: '' }); await sessionSave();   // a later change: settings only, the picture is not stored again
  applySettings({ cols: 66, captionBottom: 'hello' }); Edits.cells.set(7, { cp: 0x40, rgb: null }); Edits.ver++; await sessionSave();
  const saved = await sessionLoad();
  ok('Session: the last picture is kept in the browser', !!saved && saved.state.meta.source.name === 'beach.png' && !!saved.source);
  reset(); await demoAnim(); await wait(30);
  await sessionResume(saved); App.dirty = true; renderNow();
  ok('Session: Continue brings back the picture, settings and edits', App.src.name === 'beach.png' && S.mode === 'quad' && S.cols === 66 && Edits.cells.size === 1 && resultText(App.res) === text0);
  await sessionForget(true);
  ok('Session: Forget removes it', !(await sessionLoad()));
  ok('Session: offered on the start screen', !!$('#resumeBox') && $('#resumeBox').hidden);
});

UI_TESTS.push(async function versions(ok, { wait }) {
  Versions.list = []; buildVersions();
  await demoImage(); await wait(30); applySettings({ mode: 'braille', cols: 80 }); renderNow();
  const vb = $('#versions').getBoundingClientRect();
  ok('Versions: the strip sits in the view bar (no style clash)', vb.height < 60 && vb.width < 600, `${vb.width | 0}×${vb.height | 0}`);
  $('#verAdd').click();
  applySettings({ mode: 'ascii', charset: 'detailed', colorMode: 'color' }); renderNow();
  $('#verAdd').click();
  ok('Versions: two kept', Versions.list.map(v => v.name).join() === 'A,B' && $$('#versions .ver').length === 2 && $('#versions .ver[data-ver="B"]').classList.contains('on'));
  $('#versions .ver[data-ver="A"]').click(); renderNow();
  ok('Versions: click switches back', S.mode === 'braille' && $('#versions .ver[data-ver="A"]').classList.contains('on'));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
  ok('Versions: key 2 switches to B', S.mode === 'ascii' && S.colorMode === 'color');
  UndoHistory.step(true);
  ok('Versions: switching can be undone', S.mode === 'braille');
  $('#versions .ver[data-ver="A"]').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' })); await wait(200); renderNow();
  ok('Versions: pointing previews it', !!App.peek && App.peek.mode === 'braille');
  endPeek();
  const thumb = $('#versions .ver canvas').getContext('2d').getImageData(0, 0, 44, 28).data;
  ok('Versions: each has a small picture', thumb.some((v, i) => i % 4 !== 3 && v > 30));
  const { meta } = await projectParts(false);
  ok('Versions: kept in projects', meta.versions && meta.versions.length === 2);
  $('#versions .ver[data-ver="A"] .vdel').click();
  ok('Versions: delete', Versions.list.length === 1 && Versions.list[0].name === 'B');
  Versions.list = []; buildVersions();
});

UI_TESTS.push(async function rampsOverTime(ok, { wait }) {
  Ramps.list = []; buildRampsUI(); rampsChanged();
  await demoAnim(); await wait(30); setPlaying(false); applySettings({ mode: 'ascii', cols: 60, brightness: 0 }); renderNow();
  ok('Change over time: offered for animations', getComputedStyle($('.anim-only')).display !== 'none');
  $('#rampAdd').click();
  const r = Ramps.list[0]; r.from = -0.8; r.to = 0.3; buildRampsUI(); rampsChanged();
  const [a, b] = trimRange();
  ok('Change over time: start and end values', settingsAt(a).brightness === -0.8 && Math.abs(settingsAt(b).brightness - 0.3) < 1e-9 && Math.abs(settingsAt((a + b) / 2).brightness + 0.25) < 1e-3);
  ok('Change over time: your own setting is untouched', S.brightness === 0);
  App.time = App.src.frames[1].t0; App.dirty = true; renderNow(); const dark = resultText(App.res);
  App.time = App.src.frames[46].t0; App.dirty = true; renderNow(); const light = resultText(App.res);
  ok('Change over time: playback follows it', dark !== light && (dark.match(/ /g) || []).length > (light.match(/ /g) || []).length);
  const all = await collectResults(() => {});
  ok('Change over time: exported frames follow it', resultText(all[0].res) !== resultText(all[all.length - 1].res) && resultText(all[1].res) === dark);
  r.ease = 'back'; rampsChanged();
  ok('Change over time: "there and back" ends where it starts', Math.abs(settingsAt(a).brightness - settingsAt(b).brightness) < 1e-6);
  const { meta } = await projectParts(false);
  ok('Change over time: kept in projects', meta.ramps && meta.ramps[0].key === 'brightness');
  Ramps.list = []; buildRampsUI(); rampsChanged();
  ok('Change over time: none = your settings', settingsAt(1) === S);
});

UI_TESTS.push(async function pixelFont(ok) {
  ok('Pixel font: every printable ASCII character', Array.from({ length: 95 }, (_, i) => 32 + i).every(cp => !!pixelGlyph(cp)));
  const R = []; pixelCharRects(0x41, 0, 0, 6, 12, R);
  ok('Pixel font: "A" is drawn in whole pixels', R.length > 0 && R.every(v => Number.isInteger(v)));
  R.length = 0; pixelCharRects(0x2588, 0, 0, 6, 12, R);
  ok('Pixel font: full block fills the cell', R.join() === '0,0,6,12');
  R.length = 0; pixelCharRects(0x28FF, 0, 0, 6, 12, R);
  ok('Pixel font: braille has 8 dots', R.length === 32);
  const St = Object.assign({}, DEFAULTS, { mode: 'ascii', cols: 50, fontFamily: 'pixel', colorMode: 'color' }), r = uiDemoRes(St);
  const a = document.createElement('canvas'), b = document.createElement('canvas'); a.getContext('2d', { willReadFrequently: true }); b.getContext('2d', { willReadFrequently: true });
  renderResult(r, St, a, 1); renderResult(r, St, b, 1);
  ok('Pixel font: draws the picture', a.width > 100 && a.toDataURL() === b.toDataURL());
  const svg = resultSVG(r, St);
  ok('Pixel font: SVG has the same pixels as paths, no text', svg.includes('<path') && !svg.includes('<text'));
  const T = getGlyphTable(glyphChars(St), FONTS.pixel);
  ok('Pixel font: the Shape style measures its bitmaps', T.vecs.length === 95 * 32 && T.mean[0] === 0);
  if (Pool.size()) {
    const c = demoCanvas(), Sg = Object.assign({}, St, { mode: 'glyph' }), pre = convertInputs(c, c.width, c.height, Sg), w = await Pool.run('convertPre', { pre, sw: c.width, sh: c.height, St: Sg });
    const m = convertCore(null, c.width, c.height, Sg, null, pre);
    ok('Pixel font: Shape style is identical on a worker', w.cp.every((v, i) => v === m.cp[i]));
  }
});

UI_TESTS.push(async function paletteTools(ok, { wait }) {
  const p = parsePaletteText('GIMP Palette\nName: test\n#\n 26  28  44\tink\n93 39 93\n#b13e53, ef7d57 #FFF abc');
  ok('Palette: reads .gpl lines and hex codes', p.length === 6 && p[0].join() === '26,28,44' && p[4].join() === '255,255,255' && p[5].join() === '170,187,204', JSON.stringify(p));
  await demoImage(); await wait(30);
  $('#palN').value = '8'; $('#palFromPic').click(); renderNow();
  const cols = parsePaletteText(S.customPalette);
  ok('Palette: taken from the picture', S.colorMode === 'app' && S.appPalette === 'custom' && cols.length === 8);
  const allowed = new Set(cols.map(c => c.join())); let bad = 0; const f = App.res.fg; for (let i = 0; i < f.length; i += 3) if (!allowed.has(f[i] + ',' + f[i + 1] + ',' + f[i + 2])) bad++;
  ok('Palette: the picture uses only its colours', bad === 0 && !App.res.uniform, bad + ' outside');
  ok('Palette: swatches shown', $$('#palSwatches .swatch:not(.add)').length === 8 && !$('#palSwatches').closest('[data-when]').hidden);
  $('#palSwatches .swatch.add').click();
  ok('Palette: add a colour', parsePaletteText(S.customPalette).length === 9);
  $('#palSwatches .swatch i').click();
  ok('Palette: remove a colour', parsePaletteText(S.customPalette).length === 8);
  applySettings({ customPaletteTone: true }); renderNow();
  ok('Palette: shade by brightness', appColour(paletteKey(S), 0, 0, 0).join() === parsePaletteText(S.customPalette)[0].join());
  const { meta } = await projectParts(false);
  ok('Palette: kept in projects', meta.settings.customPalette === S.customPalette);
});

UI_TESTS.push(async function exportTargets(ok, { wait }) {
  await demoImage(); await wait(30); applySettings({ mode: 'braille', colorMode: 'color', cols: 60 }); renderNow(); buildExportPanel();
  const t = 'a`b\\c${x} "q"\nline 2';
  const js = codeLiteral(t, 'js'); let jsVal; try { jsVal = new Function(js + ';return art')(); } catch (e) {}
  ok('Copy as code: JavaScript string gives the text back', jsVal === t);
  ok('Copy as code: JSON string gives the text back', JSON.parse(codeLiteral(t, 'json')) === t);
  ok('Copy as code: C# verbatim string', codeLiteral('say "hi"', 'cs') === 'var art = @"say ""hi""";\n');
  ok('Copy as code: Python lines', codeLiteral('ab\ncd', 'py') === 'art = (\n    "ab\\n"\n    "cd"\n)\n');
  let got = await uiCaptureDownloads(() => exportSticker('discordEmoji'));
  const bmp = got[0] && await createImageBitmap(got[0].blob);
  ok('Sticker: Discord emoji is a 128 × 128 PNG under 256 KB', !!bmp && bmp.width === 128 && bmp.height === 128 && got[0].blob.size < 256 * 1024 && /\.png$/.test(got[0].name), got[0] && fmtBytes(got[0].blob.size));
  got = await uiCaptureDownloads(() => exportSticker('telegram'));
  ok('Sticker: Telegram is a 512 × 512 WEBP', !!got[0] && got[0].blob.type === 'image/webp' && (await createImageBitmap(got[0].blob)).width === 512);
  await demoAnim(); await wait(30);
  got = await uiCaptureDownloads(() => exportSticker('slackEmoji'));
  const gif = got[0] && decodeGIF(await got[0].blob.arrayBuffer());
  ok('Sticker: Slack emoji is an animated GIF under 128 KB', !!gif && gif.frames.length > 4 && gif.width === 128 && got[0].blob.size <= 128 * 1024, got[0] && `${gif.frames.length} frames, ${fmtBytes(got[0].blob.size)}`);
  got = await uiCaptureDownloads(() => exportSticker('discordSticker'));
  ok('Sticker: Discord sticker is an animated PNG', !!got[0] && isAPNG(new Uint8Array(await got[0].blob.arrayBuffer())) && got[0].blob.size <= 512 * 1024, got[0] && fmtBytes(got[0].blob.size));
  got = await uiCaptureDownloads(() => exportTerminalScript('sh'));
  const sh = got[0] && await got[0].blob.text();
  ok('Terminal script: .sh loops every frame', !!sh && sh.startsWith('#!/bin/sh') && (sh.match(/^TAS_FRAME$/gm) || []).length === 48 && sh.includes('\x1b[38;2;'), sh && sh.length + ' chars');
  got = await uiCaptureDownloads(() => exportTerminalScript('py'));
  const py = got[0] && await got[0].blob.text();
  ok('Terminal script: .py has frames and delays', !!py && /FRAMES = \[/.test(py) && /DELAYS = \[60, 60/.test(py));
  got = await uiCaptureDownloads(() => exportTerminalScript('ps1'));
  const ps = got[0] && new Uint8Array(await got[0].blob.arrayBuffer());
  ok('Terminal script: .ps1 is UTF-8 with BOM for Windows PowerShell', !!ps && ps[0] === 0xEF && ps[1] === 0xBB && ps[2] === 0xBF);
});

UI_TESTS.push(async function shareLinks(ok, { wait }) {
  await demoImage(); await wait(30); applySettings({ mode: 'braille', colorMode: 'color', cols: 50, bg: '#102030' }); renderNow();
  const res = App.res, link = await artLink(res);
  ok('Link: the art is inside the link', /#art=[A-Za-z0-9_-]+$/.test(link), link.length + ' characters');
  await demoAnim(); applySettings({ bg: '#000000' });
  await openArtLink(link.slice(link.indexOf('#'))); App.dirty = true; renderNow();
  let same = App.src.kind === 'text' && App.res.cols === res.cols && App.res.rows === res.rows;
  for (let i = 0; same && i < res.cp.length; i++) if ((App.res.cp[i] || 32) !== (res.cp[i] || 32)) same = false;
  for (let i = 0; same && i < res.fg.length; i++) if (App.res.fg[i] !== res.fg[i]) same = false;
  ok('Link: opening it shows the same characters and colours', same && S.bg === '#102030');
  const mono = textResult('hello\nworld', Object.assign({}, S, { colorMode: 'mono' }));
  const l2 = await artLink(mono); await openArtLink(l2.slice(l2.indexOf('#'))); App.dirty = true; renderNow();
  ok('Link: one-colour text stays plain text', resultText(App.res) === 'hello\nworld' && S.colorMode === 'mono');
  const bad = await openArtLink('#art=AAAA');
  ok('Link: a broken link is refused', bad === false);
});

UI_TESTS.push(async function findTool(ok, { wait }) {
  await demoImage(); await wait(30);
  openFind();
  ok('Find a tool: opens with every tool listed', $('#findDialog').open && $$('#findList li').length > 40 && document.activeElement === $('#findInput'), $$('#findList li').length + ' shown');
  const type = q => { $('#findInput').value = q; $('#findInput').dispatchEvent(new Event('input')); };
  type('crop'); const first = $('#findList li span').textContent;
  ok('Find a tool: "crop" finds the crop tools', /crop/i.test(first) && $$('#findList li').length <= 6, first);
  type('sticker'); ok('Find a tool: "sticker"', /Stickers/.test($('#findList li span').textContent));
  type('pal'); ok('Find a tool: "pal" → palette', /palette/i.test($('#findList li span').textContent));
  type('zzzqqq'); ok('Find a tool: nothing found message', !$('#findEmpty').hidden);
  type('caption');
  $('#findInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(450);
  ok('Find a tool: Enter opens the Look tab at the caption', !$('#findDialog').open && $('#tabbtn-look').getAttribute('aria-selected') === 'true' && document.activeElement === $('#capTop'));
  openFind(); type('wipe'); $('#findInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(100);
  ok('Find a tool: runs actions too (wipe view)', App.view === 'wipe');
  setView('out');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  ok('Find a tool: Ctrl+K opens it', $('#findDialog').open); $('#findDialog').close();
  const names = new Set(toolList().map(t => t.name));
  ok("What's new: every 'Show me' leads to a tool", WHATS_NEW.every(([, t]) => names.has(t)), WHATS_NEW.filter(([, t]) => !names.has(t)).map(x => x[1]).join(', '));
  openWhatsNew();
  ok("What's new: lists the new features", $('#newsDialog').open && $$('#newsList li').length === WHATS_NEW.length);
  $('#newsDialog').close();
  ok('Grouping: the More menu has sections', $$('#morePop .menulabel').length === 4);
  ok('Grouping: the font choice is visible without Advanced', getComputedStyle(key('fontFamily').closest('.group')).display !== 'none');
  // every entry works: run each one (downloads caught, dialogs closed, the picture reopened when an entry replaced it)
  const errors = [], realOpen = HTMLInputElement.prototype.click, realWebcam = window.startWebcam;
  HTMLInputElement.prototype.click = function () {};   // no file chooser in a test
  window.startWebcam = async () => {};
  window.addEventListener('error', e => errors.push(e.message));
  for (const t of toolList()) {
    try { await uiCaptureDownloads(async () => { await t.run(); await wait(40); }); }
    catch (e) { errors.push(t.name + ': ' + e.message); }
    for (const d of $$('dialog[open]')) d.close();
    if (Crop.on) setCropMode(false); if (Mask.on) setMaskMode(false); if (Edit.on) setEditMode(false); if (Present.on) setPresent(false); if (Tour.i >= 0) endTour();
    if (!App.src || App.src.kind !== 'image') { await demoImage(); await wait(20); }
    App.zoom = 0; setView('out');
  }
  HTMLInputElement.prototype.click = realOpen; window.startWebcam = realWebcam; setAdvanced(false);
  ok('Find a tool: every entry runs without an error', errors.length === 0, errors.slice(0, 3).join(' | '));
});

/* nothing may cover the page by accident (a class name clash once made a toolbar part a full-page overlay) */
function uiCoverCheck() {
  const vw = innerWidth, vh = innerHeight, allowed = new Set(['empty', 'views', 'dropOverlay', 'progress', 'videoHost', 'tour']);
  return $$('body *').filter(el => {
    if (allowed.has(el.id) || el.closest('dialog')) return false;
    const st = getComputedStyle(el); if (st.position !== 'absolute' && st.position !== 'fixed') return false;
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
    const b = el.getBoundingClientRect(); return b.width * b.height > 0.6 * vw * vh;
  }).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''));
}
UI_TESTS.push(async function layoutCover(ok, { wait }) {
  ok('Layout: nothing unexpected covers the start screen', uiCoverCheck().length === 0, uiCoverCheck().join(', '));
  await demoImage(); await wait(30); renderNow();
  for (const tab of ['look', 'adjust', 'colour', 'crop']) setTab(tab);
  setTab('look');
  ok('Layout: nothing unexpected covers the page with a picture', uiCoverCheck().length === 0, uiCoverCheck().join(', '));
});

UI_TESTS.push(async function leanScreen(ok, { wait }) {
  try { localStorage.removeItem(CUSTOM_KEY); } catch (e) {} applyHiddenParts(new Set());
  await demoImage(); await wait(40); renderNow(); setTab('look'); S.exportGoal = 'chat'; applyGoal();
  $$('details.fold').forEach(d => { d.open = false; }); setAllLooks(false); setAdvanced(false); await wait(20);   // as a new user sees it
  const visible = el => el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : !!el.offsetWidth;
  const n = $$('button, input:not([type=hidden]), select, textarea, label.btn').filter(visible).length;
  ok('Lean: the first screen shows at most 64 controls', n <= 64, n + ' visible');
  openCustomize(); const boxes = $$('#customList input');
  boxes[0].click(); boxes[1].click();
  ok('Customize: hiding parts hides them', document.body.classList.contains('hide-steps') && getComputedStyle($('.steps')).display === 'none' && getComputedStyle($('#versions')).display === 'none');
  $('#customReset').click(); $('#customDialog').close();
  ok('Customize: "Show everything" brings them back', !document.body.classList.contains('hide-steps') && getComputedStyle($('.steps')).display !== 'none');
  setPresent(true, false); await wait(30);
  ok('Full screen: only the art is shown', document.body.classList.contains('present') && getComputedStyle($('.topbar')).display === 'none' && getComputedStyle($('.settings')).display === 'none' && $('#outCanvas').getBoundingClientRect().width > innerWidth * 0.5);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Full screen: Esc leaves it', !document.body.classList.contains('present') && getComputedStyle($('.topbar')).display !== 'none');
  applySettings({ mode: 'ascii', cols: 77 }); const link = await presentLink('demo');
  applySettings({ mode: 'braille', cols: 120 });
  await openPresentLink(link.slice(link.indexOf('#'))); await wait(40);
  ok('OBS link: opens full screen in the look of the link', document.body.classList.contains('present') && S.mode === 'ascii' && S.cols === 77 && App.src.kind === 'image');
  setPresent(false);
});

UI_TESTS.push(async function firstRunTour(ok, { wait }) {
  startTour(); await wait(20);
  ok('Tour: starts with a highlighted first step', !$('#tour').hidden && $('#tourTitle').textContent === TOUR[0].title && !$('#tourSpot').hidden);
  const seen = [];
  for (let i = 0; i < TOUR.length; i++) { const sp = $('#tourSpot').getBoundingClientRect(), el = TOUR[i].el().getBoundingClientRect(); seen.push(sp.width > 0 && Math.abs(sp.left + 6 - el.left) < 2); $('#tourNext').click(); await wait(10); }
  ok('Tour: every step highlights its part', seen.every(Boolean), seen.join(','));
  ok('Tour: Done after the last step closes it and remembers', $('#tour').hidden && localStorage.getItem(TOUR_KEY) === '1');
  startTour(); $('#tourSkip').click();
  ok('Tour: Skip closes it', $('#tour').hidden);
  startTour(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok('Tour: Esc closes it', $('#tour').hidden);
});

UI_TESTS.push(async function revealVideo(ok, { wait }) {
  await demoImage(); await wait(30); applySettings({ mode: 'braille', colorMode: 'color', cols: 60 }); renderNow();
  let got = await uiCaptureDownloads(() => exportReveal('gif', 2, 'wipe'));
  const g = got[0] && decodeGIF(await got[0].blob.arrayBuffer());
  ok('Before → after: a GIF of the right length', !!g && g.frames.length === 30, g && g.frames.length + ' frames');
  if (g) {   // the first frame is the original picture, the last one the text art
    const W = g.width, H = g.height, px = (f, x, y) => { const d = f.data || f.rgba || f.px; return d ? Array.from(d.slice((y * W + x) * 4, (y * W + x) * 4 + 3)) : null; };
    const c = document.createElement('canvas'); c.width = W; c.height = H; const cg = c.getContext('2d', { willReadFrequently: true });
    const frameRGBA = f => { cg.putImageData(f.data instanceof ImageData ? f.data : new ImageData(new Uint8ClampedArray(f.data || f.rgba), W, H), 0, 0); return cg.getImageData(0, 0, W, H).data; };
    let diff = 0; try { const a = frameRGBA(g.frames[0]), b = frameRGBA(g.frames[g.frames.length - 1]); for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 40) diff++; } catch (e) { diff = -1; }
    ok('Before → after: starts as the picture, ends as the art', diff > W * H * 0.05, diff + ' pixels differ');
  }
  if (FAST_VIDEO_OK) {
    got = await uiCaptureDownloads(() => exportReveal('webm', 2, 'fade'));
    let dur = 0; if (got[0]) { const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(got[0].blob); await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; setTimeout(r, 4000); }); dur = v.duration; }
    ok('Before → after: a WEBM video', !!got[0] && Math.abs(dur - 2) < 0.2, dur.toFixed(2) + ' s');
  }
  await demoAnim(); await wait(30);
  got = await uiCaptureDownloads(() => exportReveal('gif', 4, 'wipe'));
  const ga = got[0] && decodeGIF(await got[0].blob.arrayBuffer());
  ok('Before → after: an animation plays during the wipe', !!ga && ga.frames.length > 20);
});

UI_TESTS.push(async function printPoster(ok, { wait }) {
  await demoImage(); await wait(30); applySettings({ mode: 'braille', cols: 80 }); renderNow();
  $('#posterPaper').value = 'a4'; $('#posterDpi').value = '150'; $('#posterOrient').value = 'auto'; $('#posterTitle').value = 'Sunset'; $('#posterWhite').checked = false;
  const p = posterPage(posterOptions());
  ok('Poster: A4 at 150 dpi, landscape like the picture', p.canvas.width === 1754 && p.canvas.height === 1240, p.canvas.width + '×' + p.canvas.height);
  const g = p.canvas.getContext('2d'), corner = g.getImageData(5, 5, 1, 1).data;
  ok('Poster: the page has the art background', corner[0] === hexToRgb(S.bg)[0] && corner[2] === hexToRgb(S.bg)[2]);
  $('#posterWhite').checked = true; const w = posterPage(posterOptions()).canvas.getContext('2d').getImageData(5, 5, 1, 1).data;
  ok('Poster: white paper saves ink', w[0] === 255 && w[1] === 255 && w[2] === 255);
  const realPrint = window.print; let printed = null;
  window.print = () => { printed = { img: !!$('#printArea img'), page: $('#printPage').textContent }; };
  try { await posterPrint(); } finally { window.print = realPrint; }
  ok('Poster: printing sets the page size and shows only the poster', !!printed && printed.img && /297mm 210mm/.test(printed.page), printed && printed.page);
  window.dispatchEvent(new Event('afterprint'));
  ok('Poster: cleaned up after printing', !$('#printArea img'));
  const got = await uiCaptureDownloads(posterDownload);
  ok('Poster: PNG download', !!got[0] && got[0].blob.type === 'image/png' && got[0].blob.size > 20000);
});

UI_TESTS.push(async function plotterSvg(ok) {
  const row = textResult('----  ////\n|||||', Object.assign({}, DEFAULTS));
  const L = plotterLines(row, { hatch: false });
  ok('Plotter: a run of dashes becomes one line', L.some(l => l[1] === 2 && l[3] === 2 && Math.abs(l[2] - l[0]) === 16), JSON.stringify(L.slice(0, 3)));
  ok('Plotter: slashes join into one diagonal', L.some(l => Math.abs(l[2] - l[0]) === 16 && Math.abs(l[3] - l[1]) === 4) === false && L.filter(l => l[0] !== l[2] && l[1] !== l[3]).length === 4);
  const St = Object.assign({}, DEFAULTS, { mode: 'edge', cols: 60 }), r = uiDemoRes(St), raw = (() => { let n = 0; for (let i = 0; i < r.cp.length; i++) { const c = PLOT_CHARS[chr(r.cp[i])]; n += c ? c.length : Math.round(cellInk(r, i) * 4); } return n; })();
  const p = plotterSVG(r, { widthMm: 200, penMm: 0.3, hatch: true });
  ok('Plotter: strokes only, sized in millimetres', /width="200mm"/.test(p.svg) && /fill="none"/.test(p.svg) && !/<text|<rect/.test(p.svg));
  ok('Plotter: joining makes far fewer lines', p.lines > 50 && p.lines < raw * 0.7, `${p.lines} lines from ${raw} pieces, ${p.lengthM.toFixed(1)} m`);
  const doc = new DOMParser().parseFromString(p.svg, 'image/svg+xml');
  ok('Plotter: valid SVG', !doc.querySelector('parsererror') && doc.querySelectorAll('path').length === 1);
  const b = textResult('██\n  ', Object.assign({}, DEFAULTS)), h = plotterLines(b, { hatch: true });
  ok('Plotter: dense characters are shaded with 4 lines', h.length === 4 && h.every(l => l[1] === l[3] && Math.abs(l[2] - l[0]) === 8));
});

UI_TESTS.push(async function charsetDesigner(ok, { wait }) {
  try { localStorage.removeItem(CHARSET_STORE); } catch (e) {}
  await demoImage(); await wait(30); applySettings({ mode: 'ascii', charset: 'standard' }); fillCharsetSelect();
  openDesigner();
  ok('Designer: starts with the current characters', Designer.chars.size === CHARSETS.standard.chars.length - 1 && $$('#csGroups .csch.on').length >= 5);
  $('#csClear').click();
  for (const ch of ['█', '░', '▒', '.']) $(`#csGroups .csch[data-ch="${ch}"]`).click();
  $('#csType').value = 'oO'; $('#csType').dispatchEvent(new Event('input'));
  const ramp = designerRamp();
  ok('Designer: sorted from light to dense', ramp[0] === ' ' && ramp[ramp.length - 1] === '█' && ramp.indexOf('.') < ramp.indexOf('O') && ramp.length === 7, JSON.stringify(ramp.join('')));
  await wait(200);
  ok('Designer: preview of the picture', $('#csPreview').width > 100);
  $('#csName').value = 'My blocks'; $('#csSave').click();
  ok('Designer: saved and used', S.charset === 'custom' && S.customChars === ramp.join('') && !$('#csDialog').open && !!$('#charsetSel option[value="user:My blocks"]'));
  applySettings({ charset: 'standard' });
  const sel = $('#charsetSel'); sel.value = 'user:My blocks'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  ok('Designer: a saved set can be chosen again from the list', S.charset === 'custom' && S.customChars === ramp.join(''));
  try { localStorage.removeItem(CHARSET_STORE); } catch (e) {} fillCharsetSelect(); applySettings({ charset: 'standard' });
});

UI_TESTS.push(async function videoTools(ok, { wait, reset }) {
  reset(); await demoAnim(); await wait(30); setPlaying(false);
  const set = o => applySettings(Object.assign({ playOrder: 'forward', playSpeed: 1, loopFade: 0, frameStep: 1 }, o));
  const dur = a => a.reduce((s, f) => s + f.d, 0), texts = a => a.map(f => resultText(f.res));
  set({}); const fwd = await collectResults(() => {}), txt = texts(fwd);
  ok('Video tools: off = played as it is', !playCustom(App.src) && fwd.length === 48);
  set({ playOrder: 'reverse' }); let r = await collectResults(() => {});
  ok('Video tools: reversed', r.length === 48 && texts(r).every((t, i) => t === txt[47 - i]));
  set({ playOrder: 'boomerang' }); r = await collectResults(() => {});
  ok('Video tools: boomerang plays forward, then back (ends not doubled)', r.length === 94 && countFrames() === 94 && resultText(r[48].res) === txt[46] && resultText(r[93].res) === txt[1]);
  set({ playSpeed: 2 }); r = await collectResults(() => {});
  ok('Video tools: 2× speed is half as long', Math.abs(dur(r) - dur(fwd) / 2) <= r.length, `${dur(r)} vs ${dur(fwd)} ms`);
  set({ playSpeed: 4 }); r = await collectResults(() => {});
  ok('Video tools: very fast merges frames (no delay under 20 ms)', r.every(f => f.d >= 20) && r.length < 48 && Math.abs(dur(r) - dur(fwd) / 4) <= 25, `${r.length} frames, ${dur(r)} ms`);
  set({ loopFade: 0.5 }); r = await collectResults(() => {}); const n = 48 - r.length, rt = texts(r);
  ok('Video tools: smooth loop starts later and fades the end into the start', n >= 8 && n <= 12 && rt[0] === txt[n] && rt[r.length - 1] !== txt[47] && rt[r.length - 1] !== txt[n - 1] && rt[r.length - n - 1] === txt[47 - n], 'faded frames: ' + n);
  const f0 = Pool.failures, gif = await gifBytes(() => {});
  ok('Video tools: a GIF with crossfaded frames', gif.length > 1000 && Pool.failures === f0);
  set({ playOrder: 'reverse' }); App.time = 1; App.loop = true; setPlaying(true); await wait(300); const t1 = App.time; setPlaying(false);
  ok('Video tools: the preview plays backwards too', t1 < 1 && t1 > 0.3, 'time ' + t1.toFixed(2));
  set({});
});

UI_TESTS.push(async function shareLooks(ok, { wait }) {
  const keep = JSON.stringify(userLooks);
  await demoImage(); await wait(30);
  applySettings({ mode: 'ascii', charset: 'custom', customChars: ' .oO@', fg: '#33ff66', bg: '#001100', contrast: 0.4 });
  const want = currentLook(), link = await lookLink('Green terminal', want);
  ok('Share looks: a short link', /#look=[A-Za-z0-9_-]+$/.test(link) && link.length < 400, link.length + ' characters');
  applySettings(Object.assign(lookOnly(DEFAULTS), { cols: 77 })); userLooks = []; buildLooks();
  await openLookLink(link.slice(link.indexOf('#')));
  ok('Share looks: opening the link adds the look and uses it', userLooks.length === 1 && userLooks[0].name === 'Green terminal' && App.look === 'user:Green terminal' && S.customChars === ' .oO@' && S.fg === '#33ff66' && S.contrast === 0.4);
  ok('Share looks: your picture settings stay', S.cols === 77 && App.src.kind === 'image');
  await openLookLink(link.slice(link.indexOf('#')));
  ok('Share looks: the same look is not added twice', userLooks.length === 1);
  const got = await uiCaptureDownloads(() => saveLookFile('Green terminal', want));
  ok('Share looks: saved as a .textlook file', got.length === 1 && got[0].name === 'Green terminal.textlook');
  userLooks = []; buildLooks(); applySettings(lookOnly(DEFAULTS));
  await openFile(new File([got[0].blob], got[0].name));
  ok('Share looks: opening the file adds it too', userLooks.length === 1 && S.customChars === ' .oO@' && App.src.kind === 'image');
  ok('Share looks: your own look cards can be shared', !!$('#looks .look[data-look="user:Green terminal"] .share'));
  await openFile(new File(['{"type":"nope"}'], 'bad.textlook'));
  ok('Share looks: a wrong file is refused', userLooks.length === 1);
  userLooks = JSON.parse(keep); storeUserLooks(); buildLooks(); applySettings(lookOnly(DEFAULTS)); App.look = null; markLooks();
});

UI_TESTS.push(async function layers(ok, { wait, reset }) {
  reset(); await demoImage(); await wait(30); applySettings({ mode: 'ascii', cols: 80, layerSize: 0.5, layerX: 0.5, layerY: 0.5, layerOpacity: 1, layerBlend: 'source-over' });
  renderNow(); const text0 = resultText(App.res);
  const sq = document.createElement('canvas'); sq.width = sq.height = 64; const g = sq.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  ok('Layer: a picture is added', await setLayerFile(new File([await canvasToBlob(sq, 'image/png')], 'logo.png')) && S.layerOn && !$('#layerOpts').hidden);
  // geometry on the 960 × 640 demo: a square half the width is 3/4 of the height
  const c = document.createElement('canvas'); c.width = 300; c.height = 200; const cg = c.getContext('2d', { willReadFrequently: true }); drawLayer(cg, 960, 640, 300, 200, S);
  const a = (x, y) => cg.getImageData(x, y, 1, 1).data[3];
  ok('Layer: placed and sized on the picture', a(150, 100) === 255 && a(80, 100) === 255 && a(70, 100) === 0 && a(150, 30) === 255 && a(150, 20) === 0);
  App.dirty = true; renderNow(); const t1 = resultText(App.res);
  ok('Layer: it becomes characters', t1 !== text0 && t1.split('\n')[Math.floor(App.res.rows / 2)].includes('@'.repeat(10)) === (CHARSETS.standard.chars.slice(-1) === '@'));
  applySettings({ layerX: 0.2 }); renderNow(); const t2 = resultText(App.res);
  ok('Layer: moving it changes the result', t2 !== t1 && t2 !== text0);
  applySettings({ layerOn: false }); renderNow();
  ok('Layer: hidden = your picture as before', resultText(App.res) === text0);
  applySettings({ layerOn: true }); renderNow();
  const got = await uiCaptureDownloads(saveProject); removeLayer(); renderNow();
  ok('Layer: removed', !Layer.bmp && resultText(App.res) === text0 && $('#layerOpts').hidden);
  await openProject(new File([got[0].blob], got[0].name)); App.dirty = true; renderNow();
  ok('Layer: saved in projects', !!Layer.bmp && Layer.name === 'logo.png' && S.layerOn && resultText(App.res) === t2);
  removeLayer();
});

UI_TESTS.push(async function liveLooks(ok, { wait, reset }) {
  reset(); await demoAnim(); await wait(30); setTab('look'); setLiveLooks(true);
  const card = () => $('#looks .look[data-look] canvas').toDataURL();
  ok('Play along: the switch shows for animations', !!$('#liveLooks').offsetParent && $('#liveLooks').getAttribute('aria-pressed') === 'true');
  setPlaying(false); scheduleLooks(); await wait(500); const c0 = card();
  setPlaying(true); await wait(900); const c1 = card();
  ok('Play along: the look pictures follow the playing animation', c1 !== c0);
  setLiveLooks(false); await wait(400); const c2 = card(); await wait(700);
  ok('Play along: off = the pictures stay still', card() === c2);
  setLiveLooks(true); LiveLooks.maxMs = -1; await wait(2500); const autoOff = !LiveLooks.on;
  LiveLooks.maxMs = 250; setPlaying(false);
  ok('Play along: turns itself off when too slow', autoOff);
  setLiveLooks(true);
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
