/* =====================================================================
   Phones and tablets: settings and export as bottom sheets, pinch to zoom, swipe between Result and Original,
   double-tap to zoom
   ===================================================================== */
const isNarrow = () => window.matchMedia('(max-width: 820px)').matches;
function setSheet(which) {
  document.body.classList.toggle('sheet-settings', which === 'settings');
  document.body.classList.toggle('sheet-export', which === 'export');
  $('#mbSettings').setAttribute('aria-expanded', which === 'settings');
  $('#mbExport').setAttribute('aria-expanded', which === 'export');
  if (which) { const p = which === 'settings' ? $('#settings') : $('#exportPanel'); p.scrollTop = 0; }
}
const sheetOpen = () => document.body.classList.contains('sheet-settings') || document.body.classList.contains('sheet-export');
/* two fingers: zoom (keeping the point between them in place); one quick sideways swipe: Result ↔ Original */
const Touch = { pts: new Map(), pinch: null, swipe: null, tap: null, lastTap: 0 };
STAGE_TOOLS.unshift({
  down(e) {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return false;
    if (sheetOpen()) { setSheet(null); Touch.tap = null; return true; }   // a tap on the picture closes the sheet
    Touch.pts.set(e.pointerId, [e.clientX, e.clientY]);
    Touch.tap = Touch.pts.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;   // maybe a (double) tap
    if (Touch.pts.size === 2) {
      const [a, b] = [...Touch.pts.values()], stage = $('#stage');
      Touch.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: App.zoom || currentScaleForZoom(), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, sl: stage.scrollLeft, st: stage.scrollTop };
      Touch.swipe = null; return true;
    }
    if (Touch.pts.size === 1 && !App.zoom && App.src && !Crop.on && !Mask.on && !Edit.on && App.view !== 'wipe') { Touch.swipe = { x: e.clientX, y: e.clientY, t: performance.now() }; return true; }
    return false;
  },
  move(e) {
    if (!Touch.pts.has(e.pointerId)) return;
    Touch.pts.set(e.pointerId, [e.clientX, e.clientY]);
    const P = Touch.pinch; if (!P || Touch.pts.size < 2) return;
    const [a, b] = [...Touch.pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const z = clamp(P.z * d / Math.max(1, P.d), ZOOMS[0], ZOOMS[ZOOMS.length - 1]), stage = $('#stage'), r = stage.getBoundingClientRect();
    App.zoom = z; applyZoom();
    const k = z / P.z, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;   // keep the pinched point under the fingers
    stage.scrollLeft = (P.sl + P.mx - r.left) * k - (mx - r.left); stage.scrollTop = (P.st + P.my - r.top) * k - (my - r.top);
  },
  up(e) {
    Touch.pts.delete(e && e.pointerId);
    if (Touch.pinch) { if (Touch.pts.size < 2) Touch.pinch = null; return; }
    const sw = Touch.swipe; Touch.swipe = null; if (!sw || !e) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y, dt = performance.now() - sw.t;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && dt < 700) {
      const order = ['out', 'src'], i = order.indexOf(App.view);
      const v = dx < 0 ? order[Math.min(order.length - 1, i + 1)] : order[Math.max(0, i - 1)];
      if (v !== App.view) { setView(v); toast(v === 'src' ? 'Original' : 'Result'); }
    }
  },
});
function initMobile() {
  const forget = e => {
    const tap = Touch.tap; Touch.tap = null;
    if (tap && tap.id === e.pointerId && e.type === 'pointerup' && !Touch.pinch && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10 && performance.now() - tap.t < 300) {
      const now = performance.now();   // double-tap: zoom in to 2× / back to fit (zoomed or not)
      if (now - Touch.lastTap < 350 && App.src && !Edit.on && !Crop.on && !Mask.on) { App.zoom = App.zoom ? 0 : 2; applyZoom(); Touch.lastTap = 0; } else Touch.lastTap = now;
    }
    Touch.pts.delete(e.pointerId); if (Touch.pts.size < 2) Touch.pinch = null;
  };
  window.addEventListener('pointerup', forget, true); window.addEventListener('pointercancel', forget, true);
  $('#mbSettings').addEventListener('click', () => setSheet(document.body.classList.contains('sheet-settings') ? null : 'settings'));
  $('#mbExport').addEventListener('click', () => setSheet(document.body.classList.contains('sheet-export') ? null : 'export'));
  $$('.sheetclose').forEach(b => b.addEventListener('click', () => setSheet(null)));
  // drag a sheet's handle down to close it
  $$('.sheethead').forEach(h => {
    let y0 = null, panel = h.closest('.panel');
    h.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; y0 = e.clientY; h.setPointerCapture(e.pointerId); panel.style.transition = 'none'; });
    h.addEventListener('pointermove', e => { if (y0 == null) return; panel.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
    const end = e => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; panel.style.transition = panel.style.transform = ''; if (dy > 70) setSheet(null); };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen() && !document.querySelector('dialog[open]')) setSheet(null); });
  window.matchMedia('(max-width: 820px)').addEventListener('change', () => { if (!isNarrow()) setSheet(null); });
  // double-click (mouse): fit ↔ 100 %
  $('#stage').addEventListener('dblclick', e => { if (!App.src || Edit.on || Crop.on || Mask.on || e.target.id === 'rawText') return; App.zoom = App.zoom ? 0 : 1; applyZoom(); });
}
