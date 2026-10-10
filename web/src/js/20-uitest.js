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
      try { await t(ok, { reset, wait, say }); }
      catch (e) { console.error(e); ok(t.name + ' threw', false, e && e.message || e); }
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
