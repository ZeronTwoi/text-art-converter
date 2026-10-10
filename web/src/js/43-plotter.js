/* =====================================================================
   Plotter / laser SVG: only lines. Line characters (/ \ | - _ = + x # box lines…) become strokes, everything else
   becomes horizontal hatching by how much ink it has (0-4 lines per cell, levels nest, so equal neighbours join).
   Straight lines through many cells become one stroke; strokes are ordered to cut pen travel.
   Coordinates: 4 units per cell width and 4 per cell height, scaled to millimetres in the SVG.
   ===================================================================== */
/* segments of line characters inside a 4 × 4 cell (x0, y0, x1, y1) */
const PLOT_CHARS = (() => {
  const H = y => [0, y, 4, y], V = x => [x, 0, x, 4], D1 = [0, 4, 4, 0], D2 = [0, 0, 4, 4];
  const m = {
    '-': [H(2)], '_': [H(4)], '‾': [H(0)], '|': [V(2)], '/': [D1], '\\': [D2], '+': [H(2), V(2)], 'x': [[1, 1, 3, 3], [1, 3, 3, 1]], 'X': [D1, D2],
    '=': [H(1.5), H(2.5)], '#': [H(1.5), H(2.5), V(1.5), V(2.5)], '<': [[3, 0.5, 1, 2], [1, 2, 3, 3.5]], '>': [[1, 0.5, 3, 2], [3, 2, 1, 3.5]],
    '^': [[1, 2, 2, 0.5], [2, 0.5, 3, 2]], 'v': [[1, 1.5, 2, 3.5], [2, 3.5, 3, 1.5]], '(': [[2.5, 0, 1.5, 2], [1.5, 2, 2.5, 4]], ')': [[1.5, 0, 2.5, 2], [2.5, 2, 1.5, 4]],
    '[': [[2.5, 0, 1.5, 0], [1.5, 0, 1.5, 4], [1.5, 4, 2.5, 4]], ']': [[1.5, 0, 2.5, 0], [2.5, 0, 2.5, 4], [2.5, 4, 1.5, 4]], '*': [H(2), [1, 1, 3, 3], [1, 3, 3, 1]],
    '.': [[2, 3.4, 2, 3.6]], ',': [[2, 3.2, 1.6, 4]], ':': [[2, 1.4, 2, 1.6], [2, 3.4, 2, 3.6]], "'": [[2, 0.5, 2, 1.5]], '`': [[1.6, 0.4, 2.2, 1.2]], '~': [[0.5, 2.3, 1.5, 1.7], [1.5, 1.7, 2.5, 2.3], [2.5, 2.3, 3.5, 1.7]],
    '≡': [H(1), H(2), H(3)], '─': [H(2)], '│': [V(2)], '┼': [H(2), V(2)],
  };
  for (const [cp, arms] of Object.entries({ 0x250C: 'rd', 0x2510: 'ld', 0x2514: 'ru', 0x2518: 'lu', 0x251C: 'udr', 0x2524: 'udl', 0x252C: 'lrd', 0x2534: 'lru' })) {
    const s = []; if (arms.includes('l')) s.push([0, 2, 2, 2]); if (arms.includes('r')) s.push([2, 2, 4, 2]); if (arms.includes('u')) s.push([2, 0, 2, 2]); if (arms.includes('d')) s.push([2, 2, 2, 4]);
    m[String.fromCodePoint(+cp)] = s;
  }
  return m;
})();
const HATCH_ROWS = [2, 1, 3, 0.5];   // the y of the 1st, 2nd… hatching line in a cell (levels nest)
/* how much ink a cell has (0..1) */
function cellInk(res, i) {
  if (res.bits) { const b = res.bits[i]; let n = 0; for (let k = b; k; k &= k - 1) n++; return n / (res.mode === 'braille' ? 8 : res.mode === 'quad' ? 4 : 2); }
  if (res.val) return res.val[i];
  const cp = res.cp[i] || 32; if (isBlankCp(cp)) return 0;
  const B = BLOCK_RECTS[cp]; if (B) return Math.min(1, B.reduce((a, r) => a + r[2] * r[3], 0));   // blocks: their area
  if (cp >= 0x2591 && cp <= 0x2593) return (cp - 0x2590) / 4;                                     // shades
  if (cp > 0x2800 && cp <= 0x28FF) { let n = 0; for (let k = cp - 0x2800; k; k &= k - 1) n++; return n / 8; }   // braille dots
  const G = pixelGlyph(cp); if (!G) return 0.5;
  let n = 0; for (const row of G) for (let r = row; r; r &= r - 1) n++;
  return Math.min(1, n / 18);
}
/* the line art of a result: polylines in cell units ×4 */
function plotterLines(res, o = {}) {
  const { cols, rows, cp } = res, segs = [], hatch = o.hatch !== false;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, ch = chr(cp[i] || 32), L = PLOT_CHARS[ch], X = x * 4, Y = y * 4;
    if (L && !res.bits) { for (const [a, b, c, d] of L) segs.push([X + a, Y + b, X + c, Y + d]); continue; }
    if (!hatch) continue;
    const n = Math.round(cellInk(res, i) * 4);
    for (let k = 0; k < n; k++) segs.push([X, Y + HATCH_ROWS[k], X + 4, Y + HATCH_ROWS[k]]);
  }
  // join straight pieces: segments on one line that touch become one segment
  const key = s => { const dx = s[2] - s[0], dy = s[3] - s[1], g = Math.hypot(dx, dy) || 1; return `${(dx / g).toFixed(3)},${(dy / g).toFixed(3)}`; };
  const byStart = new Map(); for (const s of segs) { const k = s[0] + ',' + s[1] + '|' + key(s); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(s); }
  const used = new Set(), lines = [];
  for (const s of segs) {
    if (used.has(s)) continue; used.add(s);
    const cur = s.slice(), dir = key(s);
    for (;;) { const nx = (byStart.get(cur[2] + ',' + cur[3] + '|' + dir) || []).find(t => !used.has(t)); if (!nx) break; used.add(nx); cur[2] = nx[2]; cur[3] = nx[3]; }
    lines.push(cur);
  }
  // pen travel: always continue with the nearest remaining line (either direction)
  const out = [], left = new Set(lines.keys()); let px = 0, py = 0;
  while (left.size) {
    let best = -1, bd = Infinity, flip = false;
    for (const j of left) { const l = lines[j], d0 = Math.hypot(l[0] - px, l[1] - py), d1 = Math.hypot(l[2] - px, l[3] - py); if (d0 < bd) { bd = d0; best = j; flip = false; } if (d1 < bd) { bd = d1; best = j; flip = true; } if (!bd) break; }
    left.delete(best); const l = lines[best], seg = flip ? [l[2], l[3], l[0], l[1]] : l; out.push(seg); px = seg[2]; py = seg[3];
    if (left.size > 20000 && out.length % 2000 === 0) { /* very large drawings: greedy order is O(n²); keep going */ }
  }
  return out;
}
function plotterSVG(res, o) {
  const lines = plotterLines(res, o), [cw, ch] = cellSize(S, 1), wmm = o.widthMm, unitX = wmm / (res.cols * 4), unitY = unitX * (ch / cw);
  const hmm = res.rows * 4 * unitY, f = v => Math.round(v * 1000) / 1000;
  let d = '', length = 0;
  for (const [a, b, c, e] of lines) { d += `M${f(a * unitX)} ${f(b * unitY)}L${f(c * unitX)} ${f(e * unitY)}`; length += Math.hypot((c - a) * unitX, (e - b) * unitY); }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(wmm)}mm" height="${f(hmm)}mm" viewBox="0 0 ${f(wmm)} ${f(hmm)}">\n<g fill="none" stroke="#000" stroke-width="${o.penMm}" stroke-linecap="round">\n<path d="${d}"/>\n</g>\n</svg>\n`;
  return { svg, lines: lines.length, lengthM: length / 1000, wmm, hmm };
}
function plotterOptions() { return { widthMm: +$('#plotWidth').value, penMm: +$('#plotPen').value, hatch: $('#plotHatch').checked }; }
function updatePlotInfo() {
  if (!App.res) return;
  const r = plotterSVG(App.res, plotterOptions());
  $('#plotInfo').textContent = `${Math.round(r.wmm)} × ${Math.round(r.hmm)} mm · ${r.lines.toLocaleString()} lines · ${r.lengthM.toFixed(1)} m of pen`;
}
function openPlotter() { if (!requireRes()) return; updatePlotInfo(); $('#plotDialog').showModal(); }
function initPlotter() {
  for (const id of ['plotWidth', 'plotPen', 'plotHatch']) $('#' + id).addEventListener('input', () => { $('#plotWidthOut').textContent = $('#plotWidth').value + ' mm'; updatePlotInfo(); });
  $('#plotCancel').addEventListener('click', () => $('#plotDialog').close());
  $('#plotSave').addEventListener('click', () => { const r = plotterSVG(App.res, plotterOptions()); $('#plotDialog').close(); download(new Blob([r.svg], { type: 'image/svg+xml' }), baseName() + '_plotter.svg'); toast(`Plotter SVG saved: ${r.lines.toLocaleString()} lines, ${r.lengthM.toFixed(1)} m`); });
}
