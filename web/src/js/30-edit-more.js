/* =====================================================================
   More editing: type text at a cursor, select a box of cells (copy, cut, paste, move, delete, fill),
   flood fill an area of one character
   ===================================================================== */
const blankCp = () => S.mode === 'braille' && S.brailleBlank !== 'space' ? 0x2800 : 32;
const isBlankLike = cp => cp === 32 || cp === 0x2800 || cp === 0 || cp === 0x3000;
/* one undo step for a burst of the same action (typing letter after letter is one step) */
function editsSnapshotGroup(kind) {
  const now = performance.now();
  if (Edit.lastKind !== kind || now - Edit.lastT > 1500) editsSnapshot();
  Edit.lastKind = kind; Edit.lastT = now;
}
function editPut(x, y, cp, rgb) {
  const res = App.res; if (!res || x < 0 || y < 0 || x >= res.cols || y >= res.rows) return false;
  if (!Edits.cells.size) { Edits.cols = res.cols; Edits.rows = res.rows; }
  Edits.cells.set(y * res.cols + x, { cp, rgb });
  return true;
}
const brushRgb = () => Edit.keep ? null : Edit.rgb;
/* the picture as it is now, edits included (operations can come faster than the screen is redrawn) */
function freshRes() { try { const r = computeCurrent(); if (r) { App.res = r; return r; } } catch (e) { console.warn(e); } return App.res; }
/* the cell under the pointer, kept inside the picture (for dragging boxes past the edge) */
function cellAtClamped(e) {
  const out = $('#outCanvas'), res = App.res; if (!res) return null;
  const b = out.getBoundingClientRect(), k = out.width / b.width, [cw, ch] = cellSize(S, 1), [, , mx, my] = pictureSize(0, 0, S, 1);
  const x = clamp(Math.floor(((e.clientX - b.left) * k - mx) / cw), 0, res.cols - 1), y = clamp(Math.floor(((e.clientY - b.top) * k - my) / ch), 0, res.rows - 1);
  return { x, y, i: y * res.cols + x };
}
/* ---- typing ---- */
function typeText(text) {
  const res = App.res, c = Edit.cursor; if (!res || !c) return;
  if (!editsMatch(res)) return toast(`Your edits were made at ${Edits.cols} × ${Edits.rows} characters`, 'error');
  editsSnapshotGroup('type');
  for (const ch of Array.from(text.replace(/\r\n?/g, '\n'))) {
    if (ch === '\n') { c.x = c.x0; c.y = Math.min(res.rows - 1, c.y + 1); continue; }
    if (ch === '\t') continue;
    editPut(c.x, c.y, ch === ' ' ? blankCp() : ch.codePointAt(0), brushRgb());
    if (c.x < res.cols - 1) c.x++;
  }
  editsChanged(); placeEditOverlay();
}
function typeKey(e) {
  const res = App.res, c = Edit.cursor; if (!res || !c) return false;
  const k = e.key;
  if (k === 'Enter') { c.x = c.x0; c.y = Math.min(res.rows - 1, c.y + 1); }
  else if (k === 'ArrowLeft') c.x = Math.max(0, c.x - 1);
  else if (k === 'ArrowRight') c.x = Math.min(res.cols - 1, c.x + 1);
  else if (k === 'ArrowUp') c.y = Math.max(0, c.y - 1);
  else if (k === 'ArrowDown') c.y = Math.min(res.rows - 1, c.y + 1);
  else if (k === 'Home') c.x = c.x0;
  else if (k === 'Backspace' || k === 'Delete') {   // back to the picture's own character there
    if (k === 'Backspace') { if (c.x === 0) return true; c.x--; }
    editsSnapshotGroup('type');
    if (Edits.cells.delete(c.y * res.cols + c.x)) editsChanged();
  } else if (Array.from(k).length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { typeText(k); return true; }
  else return false;
  placeEditOverlay(); return true;
}
/* ---- selection ---- */
const selNorm = s => s && { x0: Math.min(s.ax, s.bx), y0: Math.min(s.ay, s.by), x1: Math.max(s.ax, s.bx), y1: Math.max(s.ay, s.by) };
function selCells(r, fn) { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) fn(x, y); }
function selCopy(cut) {
  const r = selNorm(Edit.sel), res = freshRes(); if (!r || !res) return;
  const cells = [], lines = [];
  for (let y = r.y0; y <= r.y1; y++) { let line = ''; for (let x = r.x0; x <= r.x1; x++) { const i = y * res.cols + x, cp = res.cp[i] || 32; cells.push({ cp, rgb: cellRGB(res, i) }); line += chr(cp); } lines.push(line); }
  Edit.clip = { w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1, cells, text: lines.join('\n') };
  copyText(Edit.clip.text);
  if (cut) selClear(true);
  toast(`${cut ? 'Cut' : 'Copied'} ${Edit.clip.w} × ${Edit.clip.h} characters. Paste with Ctrl+V`);
  updateEditUI();
}
function selClear(quiet) {
  const r = selNorm(Edit.sel); if (!r || !editsMatch(App.res)) return;
  editsSnapshot(); const b = blankCp(); selCells(r, (x, y) => editPut(x, y, b, null)); editsChanged();
  if (!quiet) toast('Cleared');
}
function selFill() {
  const r = selNorm(Edit.sel); if (!r || !editsMatch(App.res)) return;
  editsSnapshot(); selCells(r, (x, y) => editPut(x, y, Edit.cp, brushRgb())); editsChanged();
}
/* paste the copied cells at the cursor / selection corner (or text from the system clipboard) */
function editPaste(text) {
  const res = App.res; if (!res || !editsMatch(res)) return;
  const at = Edit.sel ? selNorm(Edit.sel) : Edit.cursor ? { x0: Edit.cursor.x, y0: Edit.cursor.y } : { x0: 0, y0: 0 };
  if (text != null && (!Edit.clip || text !== Edit.clip.text)) {   // plain text: typed in at that place
    Edit.cursor = { x: at.x0, y: at.y0, x0: at.x0 }; Edit.lastKind = null; typeText(text); return;
  }
  const C = Edit.clip; if (!C) return toast('Nothing copied yet');
  editsSnapshot();
  for (let y = 0; y < C.h; y++) for (let x = 0; x < C.w; x++) { const c = C.cells[y * C.w + x]; editPut(at.x0 + x, at.y0 + y, c.cp, c.rgb); }
  Edit.sel = { ax: at.x0, ay: at.y0, bx: Math.min(res.cols - 1, at.x0 + C.w - 1), by: Math.min(res.rows - 1, at.y0 + C.h - 1) };
  editsChanged(); placeEditOverlay();
}
/* moves the selected cells by (dx, dy): the old place becomes empty */
function selMoveBy(dx, dy) {
  const r = selNorm(Edit.sel), res = freshRes(); if (!r || (!dx && !dy)) return;
  dx = clamp(dx, -r.x0, res.cols - 1 - r.x1); dy = clamp(dy, -r.y0, res.rows - 1 - r.y1); if (!dx && !dy) return;
  const cells = []; selCells(r, (x, y) => { const i = y * res.cols + x; cells.push({ x, y, cp: res.cp[i] || 32, rgb: cellRGB(res, i) }); });
  editsSnapshot(); const b = blankCp();
  for (const c of cells) editPut(c.x, c.y, b, null);
  for (const c of cells) editPut(c.x + dx, c.y + dy, c.cp, c.rgb);
  Edit.sel = { ax: r.x0 + dx, ay: r.y0 + dy, bx: r.x1 + dx, by: r.y1 + dy };
  editsChanged(); placeEditOverlay();
}
/* ---- flood fill: the connected area of the clicked character becomes the brush ---- */
function floodFill(c) {
  const res = freshRes(); if (!res || !editsMatch(res)) return;
  const { cols, rows } = res, key = i => { const cp = res.cp[i] || 32; return isBlankLike(cp) ? -1 : cp; }, want = key(c.i);
  const seen = new Uint8Array(cols * rows), stack = [c.i]; let n = 0;
  editsSnapshot();
  while (stack.length && n < 250000) {
    const i = stack.pop(); if (seen[i] || key(i) !== want) continue;
    seen[i] = 1; n++;
    const x = i % cols, y = (i / cols) | 0; editPut(x, y, Edit.cp, brushRgb());
    if (x > 0) stack.push(i - 1); if (x < cols - 1) stack.push(i + 1); if (y > 0) stack.push(i - cols); if (y < rows - 1) stack.push(i + cols);
  }
  editsChanged(); toast(`Filled ${n} characters`);
}
/* ---- the cursor and the selection box over the picture ---- */
function cellBoxCss(x0, y0, x1, y1) {
  const out = $('#outCanvas'), k = out.offsetWidth / Math.max(1, out.width), [cw, ch] = cellSize(S, 1), [, , mx, my] = pictureSize(0, 0, S, 1);
  return { left: out.offsetLeft + (mx + x0 * cw) * k + 'px', top: out.offsetTop + (my + y0 * ch) * k + 'px', width: (x1 - x0 + 1) * cw * k + 'px', height: (y1 - y0 + 1) * ch * k + 'px' };
}
function placeEditOverlay() {
  const cur = $('#editCursor'), sel = $('#editSel'), on = Edit.on && App.view === 'out' && !!App.res;
  const c = on && Edit.tool === 'type' && Edit.cursor, r = on && Edit.tool === 'select' && selNorm(Edit.sel);
  cur.hidden = !c; sel.hidden = !r;
  if (c) Object.assign(cur.style, cellBoxCss(c.x, c.y, c.x, c.y));
  if (r) Object.assign(sel.style, cellBoxCss(r.x0, r.y0, r.x1, r.y1));
  const any = !!selNorm(Edit.sel);
  for (const id of ['editCopy', 'editCut', 'editDel', 'editFillSel']) $('#' + id).disabled = !any;
  $('#editPaste').disabled = !Edit.clip;
}
const EDIT_TIPS = {
  paint: 'Brush: click or drag to put the character there.',
  pick: 'Pick: click a character in the picture to use it (and its colour) as the brush.',
  erase: 'Erase: drag over edited characters to bring the picture back.',
  type: 'Type: click where to start, then type. Enter = next line, Backspace = undo a letter, Ctrl+V pastes text.',
  select: 'Select: drag a box. Drag inside it to move it. Ctrl+C / X / V, Delete, or Fill with the brush.',
  fill: 'Fill: click an area of one character (or of empty space) to fill all of it with the brush.',
};
