/* =====================================================================
   Overlay: captions and hand-edited characters on top of a converted result
   The conversion results stay as they are (cached, shared with workers); an overlay makes a changed copy.
   Cells it writes are flagged in res.ov, so the dot / block styles draw them as characters (or as the
   style's own dots for big captions). Everything that shows or saves a result goes through convert() /
   textResult() or a worker job with the overlay spec, so the preview, every export and the shared text match.
   ===================================================================== */
/* hand edits of single cells, for one grid size (cols × rows): index → { cp, rgb (null = keep the colour) } */
const Edits = { cols: 0, rows: 0, cells: new Map(), ver: 0, undo: [], redo: [] };
function editsClear() { Edits.cells.clear(); Edits.cols = Edits.rows = 0; Edits.ver++; Edits.undo = []; Edits.redo = []; }
const CAPTION_KEYS = ['captionTop', 'captionBottom', 'captionStyle', 'captionBox', 'captionColor'];
let ovSpecMemo = null;
/* what to draw over results made with settings S (null: nothing) */
function overlaySpec(S) {
  const top = String(S.captionTop || '').trim(), bottom = String(S.captionBottom || '').trim();
  if (!top && !bottom && !Edits.cells.size) return null;
  const ramp = (S.mode === 'ascii' || S.mode === 'edge') ? getRamp(S) : null;
  const dense = S.mode === 'halftone' ? HALFTONE_RAMP[HALFTONE_RAMP.length - 1] : ramp && ramp.length ? ramp[ramp.length - 1] : '█';
  const sig = [top, bottom, S.captionStyle, S.captionBox, S.captionColor, S.bg, S.mode, S.charAspect, S.brailleBlank, dense, Edits.ver].join('\u0001');
  if (ovSpecMemo && ovSpecMemo.sig === sig) return ovSpecMemo;
  let edits = null;
  if (Edits.cells.size) {
    const n = Edits.cells.size, idx = new Int32Array(n), cps = new Uint32Array(n), rgb = new Int32Array(n);
    let k = 0; for (const [i, e] of Edits.cells) { idx[k] = i; cps[k] = e.cp; rgb[k] = e.rgb == null ? -1 : e.rgb; k++; }
    edits = { cols: Edits.cols, rows: Edits.rows, idx, cps, rgb };
  }
  const cap = top || bottom ? { top, bottom, big: S.captionStyle === 'big', box: !!S.captionBox, rgb: hexToRgb(S.captionColor), bg: hexToRgb(S.bg),
    aspect: S.charAspect, dense: dense.codePointAt(0), blank: S.mode === 'braille' && S.brailleBlank !== 'space' ? 0x2800 : 32 } : null;
  return (ovSpecMemo = { sig, cap, edits });
}
/* a result with the overlay applied (cached per result; results that already have one are returned as they are) */
const ovMemo = new WeakMap();
function withOverlay(res, S) {
  if (!res || res.ov) return res;
  const spec = overlaySpec(S); if (!spec) return res;
  const e = ovMemo.get(res); if (e && e.sig === spec.sig) return e.res;
  const r = applyOverlay(res, spec); ovMemo.set(res, { sig: spec.sig, res: r });
  return r;
}
/* pure (runs on workers too): a copy of res with the captions and edits of spec */
function applyOverlay(res, spec) {
  const { cols, rows, mode } = res, n = cols * rows;
  if (!spec.cap && !(spec.edits && spec.edits.cols === cols && spec.edits.rows === rows)) return res;   // nothing applies to this grid
  const out = Object.assign({}, res, { cp: res.cp.slice(), fg: res.fg.slice(), bgc: res.bgc && res.bgc.slice(), bits: res.bits && res.bits.slice(), val: res.val && res.val.slice(), ov: new Uint8Array(n) });
  const { cp, fg, bgc, bits, val, ov } = out;
  let u0 = res.uniform ? (fg[0] << 16) | (fg[1] << 8) | fg[2] : -1;
  const colour = (c, k) => { const o = c * 3; fg[o] = k >> 16; fg[o + 1] = (k >> 8) & 255; fg[o + 2] = k & 255; if (out.uniform && k !== u0) out.uniform = false; };
  const text = (c, ch, k) => { cp[c] = ch; ov[c] = 1; if (bits) bits[c] = 0; if (val) val[c] = 0; if (k >= 0) colour(c, k); };
  const cap = spec.cap;
  if (cap) {
    const ck = (cap.rgb[0] << 16) | (cap.rgb[1] << 8) | cap.rgb[2], bk = (cap.bg[0] << 16) | (cap.bg[1] << 8) | cap.bg[2];
    const clear = (c) => { text(c, cap.blank, -1); if (bgc) { const o = c * 3; bgc[o] = cap.bg[0]; bgc[o + 1] = cap.bg[1]; bgc[o + 2] = cap.bg[2]; } };
    for (const [str, atTop] of [[cap.top, true], [cap.bottom, false]]) {
      if (!str) continue;
      if (cap.big) {
        const m = MODES[mode] || MODES.ascii, sx = mode === 'braille' || mode === 'quad' ? 2 : 1, sy = mode === 'braille' ? 4 : mode === 'quad' || mode === 'half' ? 2 : 1;
        const hRows = clamp(Math.round(rows * 0.2), 2, 24), r0 = atTop ? Math.min(1, rows - hRows) : Math.max(0, rows - hRows - 1);
        const R = captionRaster(str, cols * sx, hRows * sy, cap.aspect * sx / sy);
        const bx0 = R.x0 < 0 ? cols : Math.max(0, Math.floor(R.x0 / sx) - 1), bx1 = Math.min(cols - 1, Math.floor(R.x1 / sx) + 1);
        for (let y = 0; y < hRows && r0 + y < rows; y++) for (let x = 0; x < cols; x++) {
          const c = (r0 + y) * cols + x;
          let bt = 0, any = 0;
          for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) if (R[(y * sy + dy) * cols * sx + x * sx + dx]) { any = 1; bt |= mode === 'braille' ? BRAILLE_BIT[dy][dx] : mode === 'quad' ? 1 << (dy * 2 + dx) : 1 << dy; }
          if (cap.box && x >= bx0 && x <= bx1) clear(c);
          if (!any) continue;
          ov[c] = 0;   // drawn in the style itself (dots, blocks), not as a font character
          if (mode === 'braille') { cp[c] = 0x2800 + bt; bits[c] = bt; colour(c, ck); }
          else if (mode === 'quad') { cp[c] = QUAD_CHARS[bt].codePointAt(0); bits[c] = bt; colour(c, ck); }
          else if (mode === 'half' && bgc) {   // colour pixels: top half = text colour, bottom = background colour
            cp[c] = 0x2580; bits[c] = 1;
            const top = bt & 1 ? ck : (cap.box ? bk : (fg[c * 3] << 16) | (fg[c * 3 + 1] << 8) | fg[c * 3 + 2]);
            colour(c, top); if (bt & 2) { const o = c * 3; bgc[o] = cap.rgb[0]; bgc[o + 1] = cap.rgb[1]; bgc[o + 2] = cap.rgb[2]; }
          }
          else if (mode === 'half') { cp[c] = HALF_CHARS[bt].codePointAt(0); bits[c] = bt; colour(c, ck); }
          else if (mode === 'halftone') { cp[c] = cap.dense; val[c] = 1; colour(c, ck); }
          else { text(c, cap.dense, ck); ov[c] = bits ? 1 : 0; }
        }
      } else {
        const lines = wrapCaption(str, Math.max(1, cols - 2)).slice(0, Math.max(1, Math.floor(rows / 3)));
        const r0 = atTop ? Math.min(rows - 1, rows > 6 ? 1 : 0) : Math.max(0, rows - lines.length - (rows > 6 ? 1 : 0));
        lines.forEach((ln, j) => {
          const y = r0 + j; if (y < 0 || y >= rows) return;
          const chars = Array.from(ln), x0 = Math.max(0, Math.floor((cols - chars.length) / 2));
          if (cap.box) for (let x = Math.max(0, x0 - 1); x < Math.min(cols, x0 + chars.length + 1); x++) clear(y * cols + x);
          chars.forEach((ch, i) => { if (x0 + i < cols) text(y * cols + x0 + i, ch === ' ' ? cap.blank : ch.codePointAt(0), ck); });
        });
      }
    }
  }
  const ed = spec.edits;
  if (ed && ed.cols === cols && ed.rows === rows) {
    for (let k = 0; k < ed.idx.length; k++) { const c = ed.idx[k]; if (c < n) text(c, ed.cps[k], ed.rgb[k]); }
  }
  return out;
}
/* a caption split into lines of at most w characters, at spaces where possible */
function wrapCaption(str, w) {
  const out = [];
  for (const para of String(str).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let wd = word;
      while (Array.from(wd).length > w) { if (line) { out.push(line); line = ''; } const a = Array.from(wd); out.push(a.slice(0, w).join('')); wd = a.slice(w).join(''); }
      const cand = line ? line + ' ' + wd : wd;
      if (Array.from(cand).length > w) { out.push(line); line = wd; } else line = cand;
    }
    if (line) out.push(line);
  }
  return out;
}
/* big caption: the text drawn in bold letters at W×H sub-pixels (aspect = sub-pixel height ÷ width) → 0/1 per sub-pixel;
   R.x0 … R.x1 = the sub-pixel columns the text covers (x0 = -1: none) */
const capCache = new Map();
function captionRaster(str, W, H, aspect) {
  const key = str + '|' + W + 'x' + H + '|' + aspect.toFixed(3);
  let R = capCache.get(key); if (R) return R;
  // draw with square pixels at H rows, then squash the width so letters look right in tall cells
  const hpx = Math.max(8, H), wpx = Math.max(8, Math.round(W * aspect)), c = newCanvas(wpx, hpx), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, wpx, hpx);
  let size = hpx * 0.86; g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
  const tw = g.measureText(str).width; if (tw > wpx * 0.96) { size *= wpx * 0.96 / tw; g.font = `bold ${size}px Arial, Helvetica, sans-serif`; }
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(str, wpx / 2, hpx / 2 + size * 0.04);
  const d = g.getImageData(0, 0, wpx, hpx).data;
  R = new Uint8Array(W * H);
  let x0 = W, x1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const px = Math.min(wpx - 1, Math.floor((x + 0.5) * wpx / W)), py = Math.min(hpx - 1, Math.floor((y + 0.5) * hpx / H));
    if (d[(py * wpx + px) * 4] > 110) { R[y * W + x] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  }
  R.x0 = x1 < 0 ? -1 : x0; R.x1 = x1;
  if (capCache.size > 24) capCache.clear();
  capCache.set(key, R);
  return R;
}
