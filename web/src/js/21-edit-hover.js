/* =====================================================================
   The result under the pointer: hover info, and editing single characters (click, or paint with a brush)
   ===================================================================== */
/* the character cell of the shown result under a pointer event (or null) */
function cellAt(e) {
  const out = $('#outCanvas'), res = App.res; if (!res || App.peek) return null;
  const b = out.getBoundingClientRect(); if (!b.width) return null;
  const k = out.width / b.width, px = (e.clientX - b.left) * k, py = (e.clientY - b.top) * k;
  const [cw, ch] = cellSize(S, 1), [, , mx, my] = pictureSize(0, 0, S, 1);
  const x = Math.floor((px - mx) / cw), y = Math.floor((py - my) / ch);
  if (x < 0 || y < 0 || x >= res.cols || y >= res.rows) return null;
  return { x, y, i: y * res.cols + x };
}
const cellRGB = (res, i) => (res.fg[i * 3] << 16) | (res.fg[i * 3 + 1] << 8) | res.fg[i * 3 + 2];
const cpName = cp => cp === 32 ? 'space' : cp === 0x2800 ? 'blank braille' : '"' + chr(cp) + '"';
const uplus = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

/* ---- hover: which character and colour is where ---- */
function showCellTip(e, c) {
  const tip = $('#cellTip'), res = App.res;
  if (!c) { tip.hidden = true; setText('cellInfo', ''); return; }
  const cp = res.cp[c.i] || 32, rgb = hex6(cellRGB(res, c.i)), bg = res.bgc ? hex6((res.bgc[c.i * 3] << 16) | (res.bgc[c.i * 3 + 1] << 8) | res.bgc[c.i * 3 + 2]) : null;
  tip.innerHTML = `<b class="mono"></b><span></span>`;
  tip.firstChild.textContent = cp === 32 || cp === 0x2800 ? '·' : chr(cp);
  tip.firstChild.style.color = rgb;
  const info = `${cpName(cp)} ${uplus(cp)} · ${rgb}${bg ? ' on ' + bg : ''} · column ${c.x + 1}, row ${c.y + 1}` + (Edits.cells.has(c.i) && Edits.cols === res.cols ? ' · edited' : '');
  setText('cellInfo', 'Under the pointer: ' + info);
  if (!Edit.on && document.body.classList.contains('simple')) { tip.hidden = true; return; }   // the floating tip: when editing or in Advanced
  tip.lastChild.textContent = info;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + 'px';
  tip.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, e.clientY + 16)) + 'px';
}
STAGE_TOOLS.push({
  down() { return false; },
  hover(e) {
    const onOut = e.target.id === 'outCanvas' && (App.view === 'out' || App.view === 'split') && App.cellTips !== false;
    showCellTip(e, onOut ? cellAt(e) : null);
    return false;   // other tools may still set their cursor
  },
});

/* ---- editing single characters ---- */
const Edit = { on: false, tool: 'paint', cp: 0x23, rgb: 0xffffff, keep: true, last: null, prevView: null };
function editsMatch(res) { return !Edits.cells.size || (Edits.cols === res.cols && Edits.rows === res.rows); }
function setEditMode(on) {
  Edit.on = !!on && !!App.src;
  if (Edit.on) { if (Mask.on) setMaskMode(false); if (Crop.on) setCropMode(false); Edit.prevView = App.view; if (App.view !== 'out') setView('out'); }
  $('#editBtn').classList.toggle('primary', Edit.on); $('#editBtn').setAttribute('aria-pressed', Edit.on);
  $('#editBar').hidden = !Edit.on;
  applyZoom(); updateEditUI();
}
function updateEditUI() {
  $$('#editTools button').forEach(b => { const on = b.dataset.tool === Edit.tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const ci = $('#editChar'); if (document.activeElement !== ci) ci.value = chr(Edit.cp);
  $('#editColor').value = hex6(Edit.rgb); $('#editKeep').checked = Edit.keep;
  $('#editUndo').disabled = !Edits.undo.length; $('#editRedo').disabled = !Edits.redo.length;
  const res = App.res, n = Edits.cells.size;
  $('#editInfo').textContent = !n ? 'Click or drag on the picture to put the character there.' :
    res && !editsMatch(res) ? `Your ${n} edits are hidden: they were made at ${Edits.cols} × ${Edits.rows} characters. Go back to that width, or clear them.` :
    `${n} character${n > 1 ? 's' : ''} edited. Edits stay on every frame and in every export.`;
  $('#editInfo').classList.toggle('warn', !!(n && res && !editsMatch(res)));
}
function editsChanged() { Edits.ver++; App.dirty = true; updateEditUI(); scheduleSessionSave(); }
function editsSnapshot() { Edits.undo.push({ cols: Edits.cols, rows: Edits.rows, cells: new Map(Edits.cells) }); if (Edits.undo.length > 60) Edits.undo.shift(); Edits.redo = []; }
function editsStep(back) {
  const from = back ? Edits.undo : Edits.redo, to = back ? Edits.redo : Edits.undo;
  if (!from.length) { toast(back ? 'Nothing to undo in the edits' : 'Nothing to redo in the edits'); return; }
  to.push({ cols: Edits.cols, rows: Edits.rows, cells: new Map(Edits.cells) });
  const s = from.pop(); Edits.cols = s.cols; Edits.rows = s.rows; Edits.cells = s.cells;
  editsChanged();
}
/* apply the brush at one cell of the raw result (rawRes: the result without edits, for picking) */
function editCell(c) {
  const res = App.res; if (!res) return;
  if (Edit.tool === 'pick') {
    Edit.cp = res.cp[c.i] || 32; Edit.rgb = cellRGB(res, c.i); Edit.tool = 'paint'; updateEditUI();
    toast(`Brush: ${cpName(Edit.cp)} in ${hex6(Edit.rgb)}`); return;
  }
  if (Edit.tool === 'erase') { if (Edits.cells.delete(c.i)) editsChanged(); return; }
  const e = { cp: Edit.cp, rgb: Edit.keep ? null : Edit.rgb }, old = Edits.cells.get(c.i);
  if (old && old.cp === e.cp && old.rgb === e.rgb) return;
  Edits.cells.set(c.i, e); editsChanged();
}
STAGE_TOOLS.push({
  down(e) {
    if (!Edit.on || e.target.id !== 'outCanvas' || e.button !== 0) return false;
    const res = App.res; if (!res) return false;
    if (!editsMatch(res)) { toast(`Your edits were made at ${Edits.cols} × ${Edits.rows} characters. Go back to that width, or clear them to edit at this one`, 'error'); return true; }
    const c = cellAt(e); if (!c) return true;
    if (Edit.tool !== 'pick') { editsSnapshot(); if (!Edits.cells.size) { Edits.cols = res.cols; Edits.rows = res.rows; } }
    Edit.last = c; editCell(c);
    return true;
  },
  move(e) {
    if (!Edit.on || !Edit.last || Edit.tool === 'pick') return;
    const c = cellAt(e); if (!c || c.i === Edit.last.i) return;
    // every cell on the way, so fast drags leave no gaps
    const a = Edit.last, n = Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
    for (let k = 1; k <= n; k++) { const x = Math.round(a.x + (c.x - a.x) * k / n), y = Math.round(a.y + (c.y - a.y) * k / n); editCell({ x, y, i: y * App.res.cols + x }); }
    Edit.last = c;
  },
  up() { Edit.last = null; updateEditUI(); },
});
function initEditTools() {
  $('#editBtn').addEventListener('click', () => setEditMode(!Edit.on));
  $('#editDone').addEventListener('click', () => setEditMode(false));
  $$('#editTools button').forEach(b => b.addEventListener('click', () => { Edit.tool = b.dataset.tool; updateEditUI(); }));
  const ci = $('#editChar');
  ci.addEventListener('input', () => { const ch = Array.from(ci.value).pop(); if (ch) { Edit.cp = ch.codePointAt(0); ci.value = ch; if (Edit.tool !== 'paint') { Edit.tool = 'paint'; updateEditUI(); } } });
  ci.addEventListener('focus', () => ci.select());
  $('#editColor').addEventListener('input', e => { Edit.rgb = parseInt(e.target.value.slice(1), 16) || 0; Edit.keep = false; updateEditUI(); });
  $('#editKeep').addEventListener('change', e => { Edit.keep = e.target.checked; });
  $('#editUndo').addEventListener('click', () => editsStep(true));
  $('#editRedo').addEventListener('click', () => editsStep(false));
  $('#editClear').addEventListener('click', () => { if (!Edits.cells.size) return; editsSnapshot(); Edits.cells.clear(); editsChanged(); toast('Edits cleared (Undo brings them back)'); });
  $('#stage').addEventListener('pointerleave', () => { $('#cellTip').hidden = true; });
  window.addEventListener('keydown', e => {
    if (!Edit.on || document.querySelector('dialog[open]')) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) { e.preventDefault(); e.stopImmediatePropagation(); editsStep(k === 'z' && !e.shiftKey); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setEditMode(false); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && Array.from(e.key).length === 1 && e.key !== ' ') {   // type a character: it becomes the brush
      e.preventDefault(); e.stopImmediatePropagation(); Edit.cp = e.key.codePointAt(0); Edit.tool = 'paint'; updateEditUI();
    }
  }, true);
  updateEditUI();
}
