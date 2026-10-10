/* =====================================================================
   UI wiring
   ===================================================================== */
function syncControls(root = document) {
  $$('[data-key]', root).forEach(el => {
    const v = S[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el || el.type === 'range') el.value = v;
  });
  updateOutputs(); updateVisibility(); updateModeButtons();
}
function updateOutputs() {
  $$('[data-out]').forEach(o => {
    const v = S[o.dataset.out];
    o.textContent = (typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(2)) : v) + (o.dataset.suffix || '');
  });
}
function updateVisibility() {
  $$('[data-when]').forEach(el => {
    const ok = el.dataset.when.split(';').every(cond => {
      let [k, vals] = cond.split(':'); const neg = k.startsWith('!'); if (neg) k = k.slice(1);
      const has = vals.split(',').includes(String(S[k]));
      return neg ? !has : has;
    });
    el.hidden = !ok;
  });
}
function updateModeButtons() {
  $$('.mode').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  $('#modeHint').textContent = (MODES[S.mode] && MODES[S.mode].hint) || '';
}
function onSettingsChanged() {
  UndoHistory.changed();
  updateOutputs(); updateVisibility(); updateModeButtons(); updateChoices(); updateQualityButtons(); saveSettings(); App.dirty = true;
  const sig = [S.cropL, S.cropR, S.cropT, S.cropB, S.rotate, S.flipH, S.flipV, S.charAspect].join();
  if (sig !== looksSig) { looksSig = sig; scheduleLooks(); }
  updateRampStrip(); scheduleHistogram(); scheduleSessionSave(); markVersions(); buildPaletteUI();
}
function onControl(el) {
  const key = el.dataset.key; let v;
  App.look = null; markLooks();
  if (el.type === 'checkbox') v = el.checked;
  else if (typeof DEFAULTS[key] === 'number') { v = parseFloat(el.value); if (!isFinite(v)) return; if (el.min !== '' && el.type === 'number') v = clamp(v, +el.min, +el.max || Infinity); }
  else v = el.value;
  S[key] = v;
  $$(`[data-key="${key}"]`).forEach(o => { if (o !== el) { if (o.type === 'checkbox') o.checked = v; else o.value = v; } });
  onSettingsChanged();
}
function bindControls(root = document) {
  $$('[data-key]', root).forEach(el => {
    if (el._bound) return; el._bound = true;
    el.addEventListener('input', () => onControl(el));
    if (el.type === 'checkbox' || el.tagName === 'SELECT') el.addEventListener('change', () => onControl(el));
  });
  syncControls(root);
}
function applySettings(obj) { Object.assign(S, obj); syncControls(); onSettingsChanged(); }
/* ---- undo / redo of settings: changes within 350 ms (one slider drag) are one step ---- */
const HIST_SKIP = new Set(['exportGoal', 'calib', 'shareOptimize']);
const UndoHistory = {
  undo: [], redo: [], base: null, timer: 0, applying: false,
  snap() { const o = {}; for (const k in DEFAULTS) if (!HIST_SKIP.has(k)) o[k] = S[k]; return o; },
  same(a, b) { for (const k in a) if (a[k] !== b[k]) return false; return true; },
  reset() { this.undo = []; this.redo = []; this.base = this.snap(); this.update(); },
  changed() {
    if (this.applying || !this.base) return;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.commit(), 350);
    $('#btnUndo').disabled = false;
  },
  commit() {
    clearTimeout(this.timer); this.timer = 0;
    if (!this.base) return;
    const cur = this.snap(); if (this.same(cur, this.base)) { this.update(); return; }
    this.undo.push(this.base); if (this.undo.length > 100) this.undo.shift();
    this.redo = []; this.base = cur; this.update();
  },
  step(back) {
    this.commit();
    const from = back ? this.undo : this.redo, to = back ? this.redo : this.undo;
    if (!from.length) { toast(back ? 'Nothing to undo' : 'Nothing to redo'); return; }
    to.push(this.base); this.base = from.pop();
    this.applying = true;
    try { applySettings(Object.assign({}, this.base)); } finally { this.applying = false; }
    App.look = null; markLooks(); this.update();
    toast(back ? 'Undone' : 'Redone');
  },
  update() { const u = $('#btnUndo'), r = $('#btnRedo'); if (u) { u.disabled = !this.undo.length && !this.timer; r.disabled = !this.redo.length; } },
};

/* pointer tools on the picture (crop box, wipe divider, character brush…): { down(e) → true if it takes the drag,
   move(e), up(e), hover(e) → true if it handled a pointer move without a drag } */
const STAGE_TOOLS = [];
function initUI() {
  // modes
  const mg = $('#modes');
  for (const [k, m] of Object.entries(MODES)) {
    if (k === 'text') continue;
    const b = document.createElement('button'); b.className = 'mode'; b.dataset.mode = k; b.title = m.hint;
    b.innerHTML = `<b>${escHTML(m.icon)}</b>${m.name}`;
    b.addEventListener('click', () => applySettings({ mode: k }));
    mg.appendChild(b);
  }
  // charsets & presets
  const cs = $('#charsetSel');
  for (const [k, c] of Object.entries(CHARSETS)) { const o = document.createElement('option'); o.value = k; o.textContent = c.name; cs.appendChild(o); }
  bindControls(document);

  $('#resetEdges').addEventListener('click', () => { const o = {}; EDGE_KEYS.forEach(k => o[k] = DEFAULTS[k]); applySettings(o); });
  $('#resetTone').addEventListener('click', () => { const o = {}; TONE_KEYS.forEach(k => o[k] = DEFAULTS[k]); applySettings(o); });
  $('#autoTrim').addEventListener('click', actAutoTrim);
  $('#maskPaint').addEventListener('click', () => setMaskMode(!Mask.on));
  $$('#maskBrushes button').forEach(b => b.addEventListener('click', () => { Mask.brush = b.dataset.brush; updateMaskUI(); if (!Mask.on) setMaskMode(true); }));
  $('#maskSize').addEventListener('input', e => { Mask.size = +e.target.value; updateMaskUI(); });
  $('#maskClearBtn').addEventListener('click', () => { if (Mask.src === App.src && Mask.canvas) { maskStrokeStart(); Mask.canvas.getContext('2d').clearRect(0, 0, Mask.canvas.width, Mask.canvas.height); Mask.pending = true; toast('Mask cleared (Undo brings it back)'); } });
  initMaskTools();
  updateMaskUI();
  $('#resetTransform').addEventListener('click', () => applySettings({ rotate: 0, flipH: false, flipV: false, cropL: 0, cropR: 0, cropT: 0, cropB: 0 }));
  $('#resetAll').addEventListener('click', () => { if (confirm('Reset every setting to its default?')) applySettings(Object.assign({}, DEFAULTS)); });
  $('#swapColors').addEventListener('click', () => applySettings({ fg: S.bg, bg: S.fg }));

  // file inputs
  $('#fileInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
  $('#btnWebcam').addEventListener('click', startWebcam);
  $('#btnText').addEventListener('click', () => openTextDialog(''));
  $('#btnDemoImg').addEventListener('click', demoImage);
  $('#btnDemoAnim').addEventListener('click', demoAnim);
  $('#btnBatch').addEventListener('click', openBatchDialog);
  $('#batchCancel').addEventListener('click', () => $('#batchDialog').close());
  $('#batchFiles').addEventListener('change', e => { const n = e.target.files.length; $('#batchCount').textContent = n ? `${n} file${n > 1 ? 's' : ''} chosen` : 'No files chosen'; $('#batchGo').disabled = !n; });
  $('#batchGo').addEventListener('click', () => {
    const files = Array.from($('#batchFiles').files), opts = { txt: $('#batchTxt').checked, html: $('#batchHtml').checked, gif: $('#batchGif').checked };
    $$('[data-bf]').forEach(el => { opts[el.dataset.bf] = el.checked; });
    $('#batchDialog').close(); if (files.length) runBatch(files, opts);
  });
  $$('[data-act]').forEach(b => b.addEventListener('click', () => ({ demoImg: demoImage, demoAnim: demoAnim, webcam: startWebcam, text: () => openTextDialog('') })[b.dataset.act]()));

  // theme
  const themes = ['auto', 'light', 'dark'];
  let theme = 'auto'; try { theme = localStorage.getItem('textArtStudio.theme') || 'auto'; } catch (e) {}
  const applyTheme = () => { if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = theme; $('#btnTheme').title = 'Theme: ' + theme; };
  applyTheme();
  $('#btnTheme').addEventListener('click', () => { theme = themes[(themes.indexOf(theme) + 1) % 3]; applyTheme(); try { localStorage.setItem('textArtStudio.theme', theme); } catch (e) {} toast('Theme: ' + theme); });

  // view & zoom
  $$('#viewSeg button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#zoomIn').addEventListener('click', () => zoomBy(1));
  $('#zoomOut').addEventListener('click', () => zoomBy(-1));
  $('#zoomLabel').addEventListener('click', () => { App.zoom = 0; applyZoom(); });
  const stage = $('#stage');
  stage.addEventListener('wheel', e => { if (!e.ctrlKey || !App.src) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  let drag = null;
  let stroke = null, tool = null;
  stage.addEventListener('pointerdown', e => {
    const capture = () => { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } };
    for (const t of STAGE_TOOLS) if (t.down(e)) { tool = t; capture(); e.preventDefault(); return; }
    if (Mask.on && e.target.id === 'srcCanvas' && e.button === 0) {
      const c = e.target, r = c.getBoundingClientRect();
      maskEnsure(); maskStrokeStart();
      stroke = { c, last: maskStroke((e.clientX - r.left) / r.width * c.width, (e.clientY - r.top) / r.height * c.height, null) };
      capture(); e.preventDefault(); return;
    }
    if (!App.zoom || e.button !== 0 || e.target.id === 'rawText') return;
    drag = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop }; $('#views').classList.add('dragging'); stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (tool) { tool.move(e); return; }
    if (!drag && !stroke) for (const t of STAGE_TOOLS) if (t.hover && t.hover(e)) break;
    if (stroke) { const r = stroke.c.getBoundingClientRect(); stroke.last = maskStroke((e.clientX - r.left) / r.width * stroke.c.width, (e.clientY - r.top) / r.height * stroke.c.height, stroke.last); return; }
    if (!drag) return; stage.scrollLeft = drag.sl - (e.clientX - drag.x); stage.scrollTop = drag.st - (e.clientY - drag.y); });
  const endDrag = e => { if (tool && tool.up) tool.up(e); tool = null; drag = null; if (stroke) maskStrokeEnd(); stroke = null; $('#views').classList.remove('dragging'); };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);

  // player
  $('#pPlay').addEventListener('click', togglePlay);
  $('#pStop').addEventListener('click', stopPlayback);
  $('#pPrev').addEventListener('click', () => stepFrame(-1));
  $('#pNext').addEventListener('click', () => stepFrame(1));
  $('#pIn').addEventListener('click', setIn);
  $('#pOut').addEventListener('click', setOut);
  $('#pClear').addEventListener('click', clearTrim);
  $('#pSpeed').addEventListener('change', e => { App.speed = parseFloat(e.target.value) || 1; if (App.src && App.src.kind === 'video') App.src.video.playbackRate = App.speed * (S.playSpeed || 1); });
  $('#pLoop').addEventListener('change', e => { App.loop = e.target.checked; });
  $('#pMute').addEventListener('click', () => { App.muted = !App.muted; if (App.src && App.src.kind === 'video') App.src.video.muted = App.muted; updateMuteBtn(); });
  const seek = $('#seek');
  seek.addEventListener('input', () => { App.seeking = true; seekTo(seek.value / 10000 * duration()); });
  seek.addEventListener('change', () => { App.seeking = false; });
  seek.addEventListener('pointerup', () => { App.seeking = false; });

  $('#copyClose').addEventListener('click', () => $('#copyDialog').close());
  initCalibration();
  // progress cancel
  $('#progCancel').addEventListener('click', () => { App.cancel = true; $('#progText').textContent = 'Cancelling…'; });

  // text dialog
  const dlg = $('#textDialog');
  $('#textCancel').addEventListener('click', () => dlg.close());
  $('#textOk').addEventListener('click', () => { const t = $('#textIn').value; dlg.close(); openTextArt(t, 'text-art.txt'); });
  $('#txtFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const { text, ansi } = await readTextArt(f);
    if (ansi) { dlg.close(); openTextArt(null, f.name, ansi, text); } else $('#textIn').value = text;
  });

  // drag & drop
  let depth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('#dropOverlay').hidden = false; });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('#dropOverlay').hidden = true; });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async e => {
    if (!hasFiles(e) && !imageUrlFrom(e.dataTransfer)) return;
    e.preventDefault(); depth = 0; $('#dropOverlay').hidden = true;
    const url = imageUrlFrom(e.dataTransfer), f = e.dataTransfer.files[0];
    // a picture dragged from a web page: prefer the original file (keeps GIF animation)
    if (url && (!f || /^image\/(png|bmp)$/.test(f.type)) && await openFromUrl(url)) return;
    if (f) openFile(f);
  });

  // paste
  window.addEventListener('paste', e => {
    if (e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
    const items = Array.from(e.clipboardData ? e.clipboardData.items : []);
    const fi = items.find(i => i.kind === 'file');
    const url = e.clipboardData ? imageUrlFrom(e.clipboardData) : null;
    if (fi) {
      e.preventDefault(); const f = fi.getAsFile();
      (async () => {
        // a copied web image comes with its address: fetch the original so animation survives
        if (url) { toast('Fetching the original image…'); if (await openFromUrl(url)) return; }
        if (f) openFile(f, 'pasted');
      })();
      return;
    }
    const txt = e.clipboardData && e.clipboardData.getData('text/plain');
    if (txt && hasAnsiCodes(txt)) { e.preventDefault(); openTextArt(txt, 'pasted.ans'); return; }
    if (url && /\.(gif|webp|png|apng|jpe?g|avif|mp4|webm)(\?|#|$)/i.test(url)) { e.preventDefault(); toast('Downloading the pasted link…'); openFromUrl(url).then(ok => { if (!ok) toast("Couldn't download that link. Save the file and open it instead", 'error'); }); return; }
    if (txt) { e.preventDefault(); openTextDialog(txt); }
  });

  // keyboard
  window.addEventListener('keydown', e => {
    const k0 = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k0 === 'z' || k0 === 'y')) {   // undo / redo (text fields keep their own)
      if (e.target.closest && e.target.closest('input[type=text],input[type=number],textarea,[contenteditable]')) return;
      if (document.querySelector('dialog[open]') || App.exporting) return;
      e.preventDefault(); UndoHistory.step(k0 === 'z' && !e.shiftKey); return;
    }
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (document.querySelector('dialog[open]') || App.exporting || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
    else if (k === 'Home') stopPlayback();
    else if (k === 'i' || k === 'I') setIn();
    else if (k === 'o' || k === 'O') setOut();
    else if (k === '+' || k === '=') zoomBy(1);
    else if (k === '-') zoomBy(-1);
    else if (k === 'f' || k === 'F') { App.zoom = 0; applyZoom(); }
  });
  // stop mouse-clicked buttons keeping focus (so Space keeps controlling playback)
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0) b.blur(); });

  initUI2();
  initCropWipe();
  initProjects();
  initEditTools();
  initEffects();
  initGuides();
  initMobile();
  initA11y();
  initPWA();
  initVersions();
  initRamps();
  initPalettes();
  initShareLink();
  initFindTool();
  initCustomize();
  initPresent();
  initTour();
  initReveal();
  initPoster();
  initPlotter();
  initDesigner();
  initSession();
  buildExportPanel();
  requestAnimationFrame(tick);
}
function setView(v) {
  if (Crop.on && v !== 'split' && v !== 'src') { Crop.prevView = null; setCropMode(false); }
  if (Edit.on && v !== 'out') setEditMode(false);
  App.view = v; $$('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.view === v)); App.dirty = true; applyZoom();
}
