/* =====================================================================
   Rendering result → canvas / text formats
   ===================================================================== */
/* size of the picture of a cols × rows result, with the margin (in character cells) around it */
function pictureSize(cols, rows, S, scale) { const [cw, ch] = cellSize(S, scale), m = Math.max(0, Math.round(S.margin) || 0); return [(cols + 2 * m) * cw, (rows + 2 * m) * ch, m * cw, m * ch]; }
function cellSize(S, scale) {
  const cw = Math.max(1, Math.round(S.fontSize * 0.6 * scale));
  const ch = Math.max(1, Math.round(cw * S.charAspect));
  return [cw, ch];
}
const chrCache = new Map();
function chr(cp) { if (cp === WIDE_CONT) return ''; let s = chrCache.get(cp); if (s === undefined) { s = String.fromCodePoint(cp); chrCache.set(cp, s); } return s; }
const isBlankCp = v => v === 32 || v === 0x2800 || v === 0x3000 || v === 0 || v === WIDE_CONT;
function groupsOf(res, skip) {
  const map = new Map(), n = res.cols * res.rows, fg = res.fg;
  if (res.uniform) {
    const list = []; for (let c = 0; c < n; c++) if (!skip(c)) list.push(c);
    map.set((fg[0] << 16) | (fg[1] << 8) | fg[2], list); return map;
  }
  for (let c = 0; c < n; c++) {
    if (skip(c)) continue;
    const o = c * 3, k = (fg[o] << 16) | (fg[o + 1] << 8) | fg[o + 2];
    let l = map.get(k); if (!l) { l = []; map.set(k, l); } l.push(c);
  }
  return map;
}
/* canvas size, background, margin and tinted cells of a result's picture; returns the context and cell size */
function renderBackground(res, S, canvas, scale, opts) {
  const [cw, ch] = cellSize(S, scale), { cols, rows } = res;
  let [Wp, Hp, mx, my] = pictureSize(cols, rows, S, scale);
  if (opts.even) { Wp += Wp & 1; Hp += Hp & 1; }
  if (canvas.width !== Wp || canvas.height !== Hp) { canvas.width = Wp; canvas.height = Hp; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bgMode = opts.bgMode || S.bgMode;
  if (bgMode === 'transparent') ctx.clearRect(0, 0, Wp, Hp); else { ctx.fillStyle = S.bg; ctx.fillRect(0, 0, Wp, Hp); }
  if (mx || my) ctx.translate(mx, my);   // margin
  if (res.bgc) {
    const b = res.bgc;
    for (let y = 0; y < rows; y++) {
      let x0 = 0, k0 = -1;
      for (let x = 0; x <= cols; x++) {
        let k = -2;
        if (x < cols) { const o = (y * cols + x) * 3; k = (b[o] << 16) | (b[o + 1] << 8) | b[o + 2]; }
        if (k !== k0) { if (k0 >= 0) { ctx.fillStyle = hex6(k0); ctx.fillRect(x0 * cw, y * ch, (x - x0) * cw, ch); } x0 = x; k0 = k; }
      }
    }
  }
  return { ctx, cw, ch };
}
/* the "picture on top" in its Sharp style: the picture itself, drawn over the characters (every
   source kind, including text art). The bitmap comes from sharpLayerBmp(): the open layer here,
   the job's own copy on a worker. */
function drawSharpLayer(ctx, W, H, S) {
  const b = S.layerOn && S.layerStyle === 'sharp' && S.layerOpacity > 0 ? sharpLayerBmp() : null;
  if (!b) return;
  const w = W * S.layerSize, h = w * b.height / b.width;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = S.layerOpacity; ctx.globalCompositeOperation = S.layerBlend;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(b, S.layerX * W - w / 2, S.layerY * H - h / 2, w, h);
  ctx.restore();
}
function renderResult(res, S, canvas, scale = 1, opts = {}) {
  const { ctx, cw, ch } = renderBackground(res, S, canvas, scale, opts), { cols } = res;
  const m = res.mode, shapes = S.renderStyle === 'shapes' && MODES[m] && MODES[m].shapes;
  const X = c => (c % cols) * cw, Y = c => ((c / cols) | 0) * ch;
  if (shapes && (m === 'braille' || m === 'quad' || m === 'half')) {
    const bits = res.bits, groups = groupsOf(res, c => !bits[c]);
    const r = Math.max(0.35, Math.min(cw / 4, ch / 8) * S.dotSize), sq = S.dotShape === 'square';
    const hw = cw / 2, hh = ch / 2;
    for (const [k, list] of groups) {
      ctx.fillStyle = hex6(k); ctx.beginPath();
      for (const c of list) {
        const x0 = X(c), y0 = Y(c), bt = bits[c];
        if (m === 'braille') {
          for (let j = 0; j < 8; j++) {
            if (!(bt & (1 << j))) continue;
            const p = BRAILLE_POS[j], px = x0 + cw * (0.25 + 0.5 * p[0]), py = y0 + ch * (0.125 + 0.25 * p[1]);
            if (sq) ctx.rect(px - r, py - r, 2 * r, 2 * r); else { ctx.moveTo(px + r, py); ctx.arc(px, py, r, 0, 6.2832); }
          }
        } else if (m === 'quad') {
          if (bt & 1) ctx.rect(x0, y0, hw, hh);
          if (bt & 2) ctx.rect(x0 + hw, y0, hw, hh);
          if (bt & 4) ctx.rect(x0, y0 + hh, hw, hh);
          if (bt & 8) ctx.rect(x0 + hw, y0 + hh, hw, hh);
        } else {
          if (bt & 1) ctx.rect(x0, y0, cw, hh);
          if (bt & 2) ctx.rect(x0, y0 + hh, cw, hh);
        }
      }
      ctx.fill();
    }
  } else if (shapes && m === 'halftone') {
    // two dots per cell, the lower one half a cell to the right; a dot covers as much of its half cell as its value
    const val = res.val, sq = S.dotShape === 'square', hh = ch / 2, R = Math.sqrt(cw * hh / Math.PI) * S.dotSize, Q = Math.sqrt(cw * hh) / 2 * S.dotSize;
    const groups = groupsOf(res, c => val[2 * c] < 0.02 && val[2 * c + 1] < 0.02);
    for (const [k, list] of groups) {
      ctx.fillStyle = hex6(k); ctx.beginPath();
      for (const c of list) for (let h = 0; h < 2; h++) {
        const v = val[2 * c + h]; if (v < 0.02) continue;
        const px = X(c) + cw * (h ? 0.75 : 0.25), py = Y(c) + hh * (h + 0.5);
        if (sq) { const s = Math.sqrt(v) * Q; ctx.rect(px - s, py - s, 2 * s, 2 * s); } else { const rr = Math.sqrt(v) * R; ctx.moveTo(px + rr, py); ctx.arc(px, py, rr, 0, 6.2832); }
      }
      ctx.fill();
    }
  } else if (m === 'emoji') {   // an emoji spans its cell and the next one
    ctx.font = Math.max(1, Math.min(2 * cw, ch) * 0.92) + 'px ' + EMOJI_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // colour emoji ignore the fill colour: one colour for all keeps the text drawing batched (a colour per cell
    // made photos ~100× slower); systems without colour emoji show them in the text colour
    const cp = res.cp, ov = res.ov, n = res.cols * res.rows;
    ctx.fillStyle = S.fg;
    for (let c = 0; c < n; c++) if (!isBlankCp(cp[c]) && !(ov && ov[c])) ctx.fillText(chr(cp[c]), X(c) + cw, Y(c) + ch / 2);
  } else if (S.fontFamily === 'pixel') {
    const cp = res.cp; drawPixelText(ctx, res, S, cw, ch, X, Y, c => isBlankCp(cp[c]));
  } else {
    const fontPx = Math.max(1, Math.min(cw / 0.6, ch / 1.1));
    ctx.font = fontPx + 'px ' + fontCss(S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cp = res.cp, groups = groupsOf(res, c => isBlankCp(cp[c]));
    for (const [k, list] of groups) {
      ctx.fillStyle = hex6(k);
      for (const c of list) ctx.fillText(chr(cp[c]), X(c) + cw / 2, Y(c) + ch / 2);
    }
  }
  if ((shapes || m === 'emoji') && res.ov && S.fontFamily === 'pixel') { const cp = res.cp, ov = res.ov; drawPixelText(ctx, res, S, cw, ch, X, Y, c => !ov[c] || isBlankCp(cp[c])); }
  else if ((shapes || m === 'emoji') && res.ov) {   // captions and edited cells of a dot / block / emoji picture: drawn as characters
    const fontPx = Math.max(1, Math.min(cw / 0.6, ch / 1.1)), cp = res.cp, ov = res.ov;
    ctx.font = fontPx + 'px ' + fontCss(S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [k, list] of groupsOf(res, c => !ov[c] || isBlankCp(cp[c]))) {
      ctx.fillStyle = hex6(k);
      for (const c of list) ctx.fillText(chr(cp[c]), X(c) + cw / 2, Y(c) + ch / 2);
    }
  }
  drawSharpLayer(ctx, canvas.width, canvas.height, S);
  return canvas;
}

/* The preview is drawn exactly like saved pictures (renderResult), but never twice for the same picture: an unchanged
   picture is not redrawn, and the frames of a playing animation are kept as bitmaps (within a memory budget), so later
   loops only copy them. */
const PreviewCache = { map: new Map(), bytes: 0, max: 256e6 };
function previewCacheClear() { for (const e of PreviewCache.map.values()) e.bmp.close(); PreviewCache.map.clear(); PreviewCache.bytes = 0; }
function drawPreview(res, S, canvas) {
  const sig = objId(res) + '|' + RENDER_KEYS.map(k => S[k]).join('|') + (S.layerOn && S.layerStyle === 'sharp' && Layer.bmp ? '|SL' + Layer.id : '');
  if (canvas._sig === sig) return canvas;   // this picture is already there
  const hit = PreviewCache.map.get(sig);
  if (hit) {
    PreviewCache.map.delete(sig); PreviewCache.map.set(sig, hit);
    if (canvas.width !== hit.bmp.width || canvas.height !== hit.bmp.height) { canvas.width = hit.bmp.width; canvas.height = hit.bmp.height; }
    const g = canvas.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.drawImage(hit.bmp, 0, 0);
    canvas._sig = sig; return canvas;
  }
  renderResult(res, S, canvas, 1);
  canvas._sig = sig;
  const s = App.src;
  if (s && s.kind === 'anim' && App.playing && typeof createImageBitmap === 'function') {
    createImageBitmap(canvas).then(bmp => {
      if (App.src !== s || PreviewCache.map.has(sig)) { bmp.close(); return; }
      const bytes = bmp.width * bmp.height * 4;
      PreviewCache.map.set(sig, { bmp, bytes }); PreviewCache.bytes += bytes;
      while (PreviewCache.bytes > PreviewCache.max && PreviewCache.map.size) { const [k0, e0] = PreviewCache.map.entries().next().value; e0.bmp.close(); PreviewCache.map.delete(k0); PreviewCache.bytes -= e0.bytes; }
    }, () => {});
  }
  return canvas;
}
function resultText(res) {
  const { cols, rows, cp } = res, lines = new Array(rows);
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) s += chr(cp[y * cols + x] || 32);
    lines[y] = s;
  }
  return lines.join('\n');
}
/* ---- limited "app" palettes: what chat apps / terminals can actually show in coloured text ---- */
const ANSI16 = [[0, 0, 0], [205, 49, 49], [13, 188, 121], [229, 229, 16], [36, 114, 200], [188, 63, 188], [17, 168, 205], [229, 229, 229], [102, 102, 102], [241, 76, 76], [35, 209, 139], [245, 245, 67], [59, 142, 234], [214, 112, 214], [41, 184, 219], [255, 255, 255]];
const ANSI256 = (() => { const p = ANSI16.slice(), lv = [0, 95, 135, 175, 215, 255]; for (const r of lv) for (const g of lv) for (const b of lv) p.push([r, g, b]); for (let i = 0; i < 24; i++) { const v = 8 + i * 10; p.push([v, v, v]); } return p; })();
const appCache = new Map();
/* Nearest colour the target can show. Cached per exact colour (a coarser cache key would make the answer
   depend on which colour of a bucket happened to be seen first). */
function appColour(pal, r, g, b) {
  r = clamp(Math.round(r), 0, 255); g = clamp(Math.round(g), 0, 255); b = clamp(Math.round(b), 0, 255);
  let m = appCache.get(pal); if (!m) { m = new Map(); appCache.set(pal, m); }
  const key = (r << 16) | (g << 8) | b;
  let c = m.get(key);
  if (!c) {
    if (pal === 'discord') c = hexToRgb(DISCORD_CSS[discordCode(r, g, b)]);
    else if (RETRO_PALETTES[pal]) c = retroColour(RETRO_PALETTES[pal], r, g, b);
    else if (pal.startsWith('custom')) c = retroColour(customPal(pal), r, g, b);
    else {
      const P = pal === 'ansi256' ? ANSI256 : ANSI16; let bd = Infinity;
      for (const q of P) { const dr = r - q[0], dg = g - q[1], db = b - q[2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (d < bd) { bd = d; c = q; } }
    }
    if (m.size > 200000) m.clear();
    m.set(key, c);
  }
  return c;
}
function paletteIndex(P, r, g, b) { let bi = 0, bd = Infinity; for (let i = 0; i < P.length; i++) { const q = P[i], d = (r - q[0]) ** 2 + (g - q[1]) ** 2 + (b - q[2]) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }
/* ANSI escape for a colour: exact 24-bit, or the palette codes when "App colours" is set to a terminal palette */
function ansiColour(r, g, b, bgLayer) {
  if (S.colorMode === 'app' && S.appPalette === 'ansi16') { const i = paletteIndex(ANSI16, r, g, b); return `\x1b[${(bgLayer ? 40 : 30) + (i & 7) + (i > 7 ? 60 : 0)}m`; }
  if (S.colorMode === 'app' && S.appPalette === 'ansi256') return `\x1b[${bgLayer ? 48 : 38};5;${paletteIndex(ANSI256, r, g, b)}m`;
  return `\x1b[${bgLayer ? 48 : 38};2;${r};${g};${b}m`;
}
function resultANSI(res) {
  const { cols, rows, cp, fg, bgc } = res; let out = '';
  for (let y = 0; y < rows; y++) {
    let lk = -1, lb = -1;
    for (let x = 0; x < cols; x++) {
      const c = y * cols + x, o = c * 3, k = (fg[o] << 16) | (fg[o + 1] << 8) | fg[o + 2];
      if (k !== lk) { out += ansiColour(fg[o], fg[o + 1], fg[o + 2], false); lk = k; }
      if (bgc) { const kb = (bgc[o] << 16) | (bgc[o + 1] << 8) | bgc[o + 2]; if (kb !== lb) { out += ansiColour(bgc[o], bgc[o + 1], bgc[o + 2], true); lb = kb; } }
      out += chr(cp[c] || 32);
    }
    out += '\x1b[0m\n';
  }
  return out;
}
function resultHTMLInner(res) {
  const { cols, rows, cp, fg, bgc } = res;
  if (res.uniform) return escHTML(resultText(res));
  let out = '';
  for (let y = 0; y < rows; y++) {
    let run = '', k0 = -1, b0 = -1;
    const flush = () => { if (run) out += `<span style="color:${hex6(k0)}${b0 >= 0 ? ';background:' + hex6(b0) : ''}">${run}</span>`; run = ''; };
    for (let x = 0; x < cols; x++) {
      const c = y * cols + x, o = c * 3, k = (fg[o] << 16) | (fg[o + 1] << 8) | fg[o + 2];
      const kb = bgc ? (bgc[o] << 16) | (bgc[o + 1] << 8) | bgc[o + 2] : -1;
      if (k !== k0 || kb !== b0) { flush(); k0 = k; b0 = kb; }
      run += escHTML(chr(cp[c] || 32));
    }
    flush(); out += '\n';
  }
  return out;
}
function preStyle(S) {
  const [cw, ch] = cellSize(S, 1), [, , mx, my] = pictureSize(0, 0, S, 1);
  return `font-family:${fontCss(S).replace(/"/g, "'")};font-size:${(Math.min(cw / 0.6, ch / 1.1)).toFixed(2)}px;line-height:${ch}px;${mx ? `padding:${my}px ${mx}px;` : ''}`;
}
function resultHTMLDoc(res, S, title) {
  const bg = S.bgMode === 'transparent' ? 'transparent' : S.bg;
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escHTML(title)}</title>\n<style>body{margin:0;padding:24px;background:${bg === 'transparent' ? '#ffffff00' : bg}}pre{margin:0;${preStyle(S)}color:${S.fg};white-space:pre}</style></head>\n<body><pre>${resultHTMLInner(res)}</pre></body></html>\n`;
}
function resultSVG(res, S) {
  const [W, H, mx, my] = pictureSize(res.cols, res.rows, S, 1), parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  if (S.bgMode !== 'transparent') parts.push(`<rect width="100%" height="100%" fill="${S.bg}"/>`);
  if (mx || my) parts.push(`<g transform="translate(${mx} ${my})">`);
  svgBody(res, S, parts);
  if (mx || my) parts.push('</g>');
  parts.push('</svg>');
  return parts.join('\n');
}
/* the drawing of one result (tinted cells, then dots / blocks / characters) as SVG elements */
function svgBody(res, S, parts) {
  const [cw, ch] = cellSize(S, 1), { cols, rows, cp, fg, bgc } = res;
  if (bgc) for (let c = 0; c < cols * rows; c++) { const o = c * 3; parts.push(`<rect x="${(c % cols) * cw}" y="${((c / cols) | 0) * ch}" width="${cw}" height="${ch}" fill="${hex6((bgc[o] << 16) | (bgc[o + 1] << 8) | bgc[o + 2])}"/>`); }
  const m = res.mode, shapes = S.renderStyle === 'shapes' && MODES[m] && MODES[m].shapes;
  const f = v => Math.round(v * 100) / 100;
  if (shapes) {
    const r = Math.max(0.35, Math.min(cw / 4, ch / 8) * S.dotSize), sq = S.dotShape === 'square';
    const skip = m === 'halftone' ? c => res.val[2 * c] < 0.02 && res.val[2 * c + 1] < 0.02 : c => !res.bits[c];
    for (const [k, list] of groupsOf(res, skip)) {
      let d = '';
      const dot = (px, py, rr) => sq ? `M${f(px - rr)} ${f(py - rr)}h${f(2 * rr)}v${f(2 * rr)}h${f(-2 * rr)}z` : `M${f(px - rr)} ${f(py)}a${f(rr)} ${f(rr)} 0 1 0 ${f(2 * rr)} 0a${f(rr)} ${f(rr)} 0 1 0 ${f(-2 * rr)} 0z`;
      const rect = (x, y, w, h) => `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`;
      for (const c of list) {
        const x0 = (c % cols) * cw, y0 = ((c / cols) | 0) * ch, bt = res.bits ? res.bits[c] : 0;
        if (m === 'braille') { for (let j = 0; j < 8; j++) if (bt & (1 << j)) { const p = BRAILLE_POS[j]; d += dot(x0 + cw * (0.25 + 0.5 * p[0]), y0 + ch * (0.125 + 0.25 * p[1]), r); } }
        else if (m === 'quad') { if (bt & 1) d += rect(x0, y0, cw / 2, ch / 2); if (bt & 2) d += rect(x0 + cw / 2, y0, cw / 2, ch / 2); if (bt & 4) d += rect(x0, y0 + ch / 2, cw / 2, ch / 2); if (bt & 8) d += rect(x0 + cw / 2, y0 + ch / 2, cw / 2, ch / 2); }
        else if (m === 'half') { if (bt & 1) d += rect(x0, y0, cw, ch / 2); if (bt & 2) d += rect(x0, y0 + ch / 2, cw, ch / 2); }
        else if (m === 'halftone') {
          const sqS = S.dotShape === 'square', hh = ch / 2;
          for (let h = 0; h < 2; h++) {
            const v = res.val[2 * c + h]; if (v < 0.02) continue;
            const px = x0 + cw * (h ? 0.75 : 0.25), py = y0 + hh * (h + 0.5);
            if (sqS) { const s = Math.sqrt(v * cw * hh) / 2 * S.dotSize; d += rect(px - s, py - s, 2 * s, 2 * s); } else d += dot(px, py, Math.sqrt(v * cw * hh / Math.PI) * S.dotSize);
          }
        }
      }
      parts.push(`<path fill="${hex6(k)}" d="${d}"/>`);
    }
  }
  if ((!shapes || res.ov) && S.fontFamily === 'pixel' && m !== 'emoji') {   // the pixel font: the same pixels as paths
    const ov = shapes ? res.ov : null, R = [], miss = [];
    for (const [k, list] of groupsOf(res, c => isBlankCp(cp[c]) || (ov && !ov[c]))) {
      let d = '';
      for (const c of list) { R.length = 0; if (!pixelCharRects(cp[c], (c % cols) * cw, ((c / cols) | 0) * ch, cw, ch, R)) { miss.push(c); continue; } for (let i = 0; i < R.length; i += 4) d += `M${f(R[i])} ${f(R[i + 1])}h${f(R[i + 2])}v${f(R[i + 3])}h${f(-R[i + 2])}z`; }
      if (d) parts.push(`<path fill="${hex6(k)}" d="${d}"/>`);
    }
    if (miss.length) { parts.push(`<g font-family="${FONTS.mono.replace(/"/g, "'")}" font-size="${f(Math.min(cw / 0.6, ch / 1.1))}" text-anchor="middle" dominant-baseline="central">`); for (const c of miss) { const o = c * 3; parts.push(`<text x="${f((c % cols) * cw + cw / 2)}" y="${f(((c / cols) | 0) * ch + ch / 2)}" fill="${hex6((fg[o] << 16) | (fg[o + 1] << 8) | fg[o + 2])}">${escHTML(chr(cp[c]))}</text>`); } parts.push('</g>'); }
  } else if (!shapes || res.ov) {
    const ov = shapes ? res.ov : null, wide = m === 'emoji';
    const fontPx = wide ? Math.min(2 * cw, ch) * 0.92 : Math.max(1, Math.min(cw / 0.6, ch / 1.1));
    parts.push(`<g font-family="${(wide ? EMOJI_FONT : fontCss(S)).replace(/"/g, "'")}" font-size="${f(fontPx)}" text-anchor="middle" dominant-baseline="central" xml:space="preserve">`);
    for (let y = 0; y < rows; y++) {
      let xs = [], txt = '', k0 = -1;
      const flush = () => { if (txt) parts.push(`<text x="${xs.join(' ')}" y="${f(y * ch + ch / 2)}" fill="${hex6(k0)}">${escHTML(txt)}</text>`); xs = []; txt = ''; };
      for (let x = 0; x < cols; x++) {
        const c = y * cols + x; if (isBlankCp(cp[c]) || (ov && !ov[c])) continue;
        const o = c * 3, k = (fg[o] << 16) | (fg[o + 1] << 8) | fg[o + 2];
        if (k !== k0) { flush(); k0 = k; }
        xs.push(f(x * cw + (wide && !(res.ov && res.ov[c]) ? cw : cw / 2))); txt += chr(cp[c]);
      }
      flush();
    }
    parts.push('</g>');
  }
}

