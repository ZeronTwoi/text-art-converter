/* =====================================================================
   Mask painting: undo / redo of strokes, soft or hard brush
   ===================================================================== */
const MaskHist = { undo: [], redo: [], max: 16 };
function maskSnapshot() { const c = Mask.canvas; return c ? c.getContext('2d').getImageData(0, 0, c.width, c.height) : null; }
/* before a stroke (or clearing): remember the mask as it was */
function maskStrokeStart() {
  const snap = maskSnapshot(); if (!snap) return;
  MaskHist.undo.push(snap); if (MaskHist.undo.length > MaskHist.max) MaskHist.undo.shift();
  MaskHist.redo = []; updateMaskUI();
}
function maskStrokeEnd() { updateMaskUI(); }
/* new paint takes effect: once per display frame (and before anything that must see it) */
function maskFlush() { if (Mask.pending) { Mask.pending = false; Mask.ver++; Mask.cache.clear(); App.dirty = true; } }
function maskHistReset() { MaskHist.undo = []; MaskHist.redo = []; }
function maskStep(back) {
  const from = back ? MaskHist.undo : MaskHist.redo, to = back ? MaskHist.redo : MaskHist.undo;
  if (!Mask.canvas || !from.length) { toast(back ? 'Nothing to undo in the mask' : 'Nothing to redo in the mask'); return; }
  to.push(maskSnapshot());
  const img = from.pop();
  if (img.width !== Mask.canvas.width || img.height !== Mask.canvas.height) { maskHistReset(); updateMaskUI(); return; }
  Mask.canvas.getContext('2d').putImageData(img, 0, 0);
  Mask.pending = true; updateMaskUI();
  toast(back ? 'Mask stroke undone' : 'Mask stroke redone');
}
function initMaskTools() {
  $('#maskUndo').addEventListener('click', () => maskStep(true));
  $('#maskRedo').addEventListener('click', () => maskStep(false));
  $$('#maskHardness button').forEach(b => b.addEventListener('click', () => { Mask.hard = b.dataset.hard === '1'; updateMaskUI(); }));
  // Ctrl+Z / Ctrl+Y undo mask strokes while painting (otherwise they undo settings)
  window.addEventListener('keydown', e => {
    if (!Mask.on || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = (e.key || '').toLowerCase(); if (k !== 'z' && k !== 'y') return;
    if (e.target.closest && e.target.closest('input[type=text],input[type=number],textarea,[contenteditable]')) return;
    e.preventDefault(); e.stopImmediatePropagation(); maskStep(k === 'z' && !e.shiftKey);
  }, true);
}
