/* =====================================================================
   Drawing the crop on the picture, and the before / after wipe
   ===================================================================== */
/* ---- crop: the whole picture (turned and flipped) with the crop box; drag a corner or an edge, move the box,
   or draw a new one. The sliders and the result follow while dragging. ---- */
const Crop = { on: false, drag: null, prevView: null };
const uncropped = St => Object.assign({}, St, { cropL: 0, cropR: 0, cropT: 0, cropB: 0 });
/* a point of the source → the matching point of a drawTransformed view (W×H) of it (the inverse of viewToSource) */
function sourceToView(sx, sy, W, H, sw, sh, St) {
  const [ix, iy, iw, ih] = cropRect(sw, sh, St), rot = normRot(St.rotate), swap = rot === 90 || rot === 270, dw = swap ? H : W, dh = swap ? W : H;
  const lx = (sx - ix) / iw * dw - dw / 2, ly = (sy - iy) / ih * dh - dh / 2, a = rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  let x = lx * cs - ly * sn, y = lx * sn + ly * cs;
  if (St.flipH) x = -x; if (St.flipV) y = -y;
  return [x + W / 2, y + H / 2];
}
function cropViewSize(s) {
  const swap = normRot(S.rotate) % 180 !== 0, fw = swap ? s.h : s.w, fh = swap ? s.w : s.h, k = Math.min(1, 1400 / Math.max(fw, fh));
  return [Math.max(1, Math.round(fw * k)), Math.max(1, Math.round(fh * k))];
}
/* the crop box in view coordinates */
function cropBoxInView(W, H, s) {
  const [ix, iy, iw, ih] = cropRect(s.w, s.h, S), U = uncropped(S);
  const a = sourceToView(ix, iy, W, H, s.w, s.h, U), b = sourceToView(ix + iw, iy + ih, W, H, s.w, s.h, U);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}
/* a box in view coordinates → the crop settings */
function setCropFromView(r, W, H) {
  const s = App.src, U = uncropped(S);
  const a = viewToSource(r.x0, r.y0, W, H, s.w, s.h, U), b = viewToSource(r.x1, r.y1, W, H, s.w, s.h, U);
  const x0 = clamp(Math.min(a[0], b[0]), 0, s.w), x1 = clamp(Math.max(a[0], b[0]), 0, s.w), y0 = clamp(Math.min(a[1], b[1]), 0, s.h), y1 = clamp(Math.max(a[1], b[1]), 0, s.h);
  const pc = v => Math.round(v * 1000) / 10;
  applySettings({ cropL: pc(x0 / s.w), cropR: pc((s.w - x1) / s.w), cropT: pc(y0 / s.h), cropB: pc((s.h - y1) / s.h) });
}
function drawCropView(c, d) {
  const [W, H] = cropViewSize(App.src);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  drawTransformed(g, d[0], d[1], d[2], W, H, uncropped(S));
  const r = cropBoxInView(W, H, App.src), k = W / Math.max(1, c.getBoundingClientRect().width || W), lw = Math.max(1, 1.5 * k);
  g.save();
  g.fillStyle = 'rgba(0,0,0,.58)'; g.beginPath(); g.rect(0, 0, W, H); g.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); g.fill('evenodd');
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = lw * 0.7; g.beginPath();
  for (const t of [1 / 3, 2 / 3]) { const x = r.x0 + (r.x1 - r.x0) * t, y = r.y0 + (r.y1 - r.y0) * t; g.moveTo(x, r.y0); g.lineTo(x, r.y1); g.moveTo(r.x0, y); g.lineTo(r.x1, y); }
  g.stroke();
  g.strokeStyle = '#fff'; g.lineWidth = lw; g.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  const hs = 9 * k; g.fillStyle = '#fff';
  for (const [x, y] of cropHandles(r)) g.fillRect(x - hs / 2, y - hs / 2, hs, hs);
  g.restore();
}
const cropHandles = r => { const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2; return [[r.x0, r.y0], [mx, r.y0], [r.x1, r.y0], [r.x1, my], [r.x1, r.y1], [mx, r.y1], [r.x0, r.y1], [r.x0, my]]; };
/* which edges of the box are at point p (within tol): { l, r, t, b }, or 'move' inside, or null outside */
function cropHit(r, p, tol) {
  const inY = p[1] > r.y0 - tol && p[1] < r.y1 + tol, inX = p[0] > r.x0 - tol && p[0] < r.x1 + tol;
  const e = { l: inY && Math.abs(p[0] - r.x0) < tol, r: inY && Math.abs(p[0] - r.x1) < tol, t: inX && Math.abs(p[1] - r.y0) < tol, b: inX && Math.abs(p[1] - r.y1) < tol };
  if (e.l && e.r) { if (Math.abs(p[0] - r.x0) < Math.abs(p[0] - r.x1)) e.r = false; else e.l = false; }
  if (e.t && e.b) { if (Math.abs(p[1] - r.y0) < Math.abs(p[1] - r.y1)) e.b = false; else e.t = false; }
  if (e.l || e.r || e.t || e.b) return e;
  return p[0] > r.x0 && p[0] < r.x1 && p[1] > r.y0 && p[1] < r.y1 ? 'move' : null;
}
const cropCursor = h => !h ? 'crosshair' : h === 'move' ? 'move' : (h.l && h.t) || (h.r && h.b) ? 'nwse-resize' : (h.r && h.t) || (h.l && h.b) ? 'nesw-resize' : h.l || h.r ? 'ew-resize' : 'ns-resize';
function canvasPoint(c, e) { const b = c.getBoundingClientRect(), k = c.width / Math.max(1, b.width); return [(e.clientX - b.left) * k, (e.clientY - b.top) * k, k]; }
function setCropMode(on) {
  Crop.on = !!on && !!App.src && App.src.kind !== 'text';
  if (Crop.on && Mask.on) setMaskMode(false);
  if (Crop.on && typeof Edit !== 'undefined' && Edit.on) setEditMode(false);
  $('#cropDraw').classList.toggle('primary', Crop.on);
  $('#cropDraw').textContent = Crop.on ? '✓ Done cropping' : '⬚ Draw the crop on the picture';
  $('#views').classList.toggle('cropping', Crop.on);
  if (Crop.on) { Crop.prevView = App.view; if (App.view !== 'split') setView('split'); }
  else if (Crop.prevView && App.view === 'split') { setView(Crop.prevView); Crop.prevView = null; }
  App.dirty = true;
}
STAGE_TOOLS.push({
  down(e) {
    if (!Crop.on || e.target.id !== 'srcCanvas' || e.button !== 0) return false;
    const c = e.target, [px, py, k] = canvasPoint(c, e), r = cropBoxInView(c.width, c.height, App.src);
    let h = cropHit(r, [px, py], 12 * k);
    const whole = r.x0 < 1 && r.y0 < 1 && r.x1 > c.width - 1 && r.y1 > c.height - 1;
    if (h === 'move' && whole) h = null;   // nothing cropped yet: a drag inside draws a new box
    Crop.drag = { c, r, h: h || 'new', p0: [px, py] };
    return true;
  },
  move(e) {
    const D = Crop.drag; if (!D) return;
    const { c, r } = D, W = c.width, H = c.height, [px, py] = canvasPoint(c, e), dx = px - D.p0[0], dy = py - D.p0[1], minS = Math.max(4, Math.min(W, H) * 0.03);
    let n;
    if (D.h === 'new') n = { x0: Math.min(D.p0[0], px), x1: Math.max(D.p0[0], px), y0: Math.min(D.p0[1], py), y1: Math.max(D.p0[1], py) };
    else if (D.h === 'move') { const w = r.x1 - r.x0, h = r.y1 - r.y0, x0 = clamp(r.x0 + dx, 0, W - w), y0 = clamp(r.y0 + dy, 0, H - h); n = { x0, y0, x1: x0 + w, y1: y0 + h }; }
    else {
      n = Object.assign({}, r);
      if (D.h.l) n.x0 = clamp(r.x0 + dx, 0, r.x1 - minS); if (D.h.r) n.x1 = clamp(r.x1 + dx, r.x0 + minS, W);
      if (D.h.t) n.y0 = clamp(r.y0 + dy, 0, r.y1 - minS); if (D.h.b) n.y1 = clamp(r.y1 + dy, r.y0 + minS, H);
    }
    n.x0 = clamp(n.x0, 0, W); n.x1 = clamp(n.x1, 0, W); n.y0 = clamp(n.y0, 0, H); n.y1 = clamp(n.y1, 0, H);
    if (n.x1 - n.x0 < minS || n.y1 - n.y0 < minS) return;   // a click, or too small a box
    setCropFromView(n, W, H);
  },
  up() { Crop.drag = null; },
  hover(e) {
    if (!Crop.on || e.target.id !== 'srcCanvas') return false;
    const c = e.target, [px, py, k] = canvasPoint(c, e);
    const r = cropBoxInView(c.width, c.height, App.src), h = cropHit(r, [px, py], 12 * k), whole = r.x0 < 1 && r.y0 < 1 && r.x1 > c.width - 1 && r.y1 > c.height - 1;
    c.style.cursor = cropCursor(h === 'move' && whole ? null : h);
    return true;
  },
});

/* ---- wipe: the original over the result, cut at a divider you drag ---- */
const Wipe = { pos: 50, drag: false };
const wipeTmp = document.createElement('canvas');
function drawWipeSource(c, out, d) {
  const W = out.width, H = out.height;
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const St = viewS(), g = c.getContext('2d'), [, , mx, my] = pictureSize(0, 0, St, 1), iw = Math.max(1, W - 2 * mx), ih = Math.max(1, H - 2 * my);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (St.bgMode === 'transparent') g.clearRect(0, 0, W, H); else { g.fillStyle = St.bg; g.fillRect(0, 0, W, H); }
  if (wipeTmp.width !== iw || wipeTmp.height !== ih) { wipeTmp.width = iw; wipeTmp.height = ih; }
  drawTransformed(wipeTmp.getContext('2d'), d[0], d[1], d[2], iw, ih, S);
  g.drawImage(wipeTmp, mx, my);
  placeWipe();
}
/* puts the original exactly over the result and the divider at Wipe.pos (%) */
function placeWipe() {
  const c = $('#srcCanvas'), bar = $('#wipeBar');
  if (App.view !== 'wipe') { if (c.style.position) { c.style.position = c.style.left = c.style.top = c.style.clipPath = ''; applyZoom(); } return; }
  const out = $('#outCanvas'), L = out.offsetLeft, T = out.offsetTop, W = out.offsetWidth, H = out.offsetHeight;
  Object.assign(c.style, { position: 'absolute', left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px', clipPath: `inset(0 ${(100 - Wipe.pos).toFixed(2)}% 0 0)` });
  Object.assign(bar.style, { left: (L + W * Wipe.pos / 100) + 'px', top: T + 'px', height: H + 'px' });
  bar.setAttribute('aria-valuenow', Math.round(Wipe.pos));
}
function setWipe(p) { Wipe.pos = clamp(p, 0, 100); placeWipe(); }
STAGE_TOOLS.push({
  down(e) {
    if (App.view !== 'wipe' || e.button !== 0 || !/^(outCanvas|srcCanvas|wipeBar)$/.test(e.target.id || e.target.parentNode.id)) return false;
    Wipe.drag = true; this.move(e); return true;
  },
  move(e) { if (!Wipe.drag) return; const b = $('#outCanvas').getBoundingClientRect(); setWipe((e.clientX - b.left) / Math.max(1, b.width) * 100); },
  up() { Wipe.drag = false; },
});
function initCropWipe() {
  $('#cropDraw').addEventListener('click', () => setCropMode(!Crop.on));
  const bar = $('#wipeBar');
  bar.addEventListener('keydown', e => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setWipe(Wipe.pos - step);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setWipe(Wipe.pos + step);
    else if (e.key === 'Home') setWipe(0); else if (e.key === 'End') setWipe(100); else return;
    e.preventDefault(); e.stopPropagation();
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => placeWipe()).observe($('#outCanvas'));
  window.addEventListener('resize', () => placeWipe());
  window.addEventListener('keydown', e => { if (Crop.on && (e.key === 'Escape' || e.key === 'Enter') && !e.target.closest('input,textarea,select,dialog')) { e.preventDefault(); setCropMode(false); } });
}
