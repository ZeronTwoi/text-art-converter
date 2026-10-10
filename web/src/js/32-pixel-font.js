/* =====================================================================
   Built-in pixel font ("Text Art Pixel"): the same characters on every computer. 99 glyphs drawn here on a
   5 × 9 grid (rows 7-8 for descenders); block, shade, braille, line-drawing and dot characters are drawn as
   shapes that fill the cell. Characters it does not have fall back to the system font. Saved SVGs get the
   same pixels as paths; the Shape style measures these bitmaps, so it gives the same result everywhere.
   ===================================================================== */
const PIXEL_FONT_DATA = ' 000000000!444440400"AAA000000#AAVAVAA00$4FKE5U400%OP248J300&CIK8LID00\'448000000(248884200)842224800*04LEL4000+044V44000,00000CC48-000V00000.00000CC00/11248GG000EHJLPHE0014C4444E002EH1248V003V2421HE00426AIV22005VGU11HE00668GUHHE007V124888008EHHEHHE009EHHF12C00:0CC0CC000;0CC0CC480<248G84200=00V0V0000>842124800?EH1240400@EH1DLLE00AEHHHVHH00BUHHUHHU00CEHGGGHE00DSIHHHIS00EVGGUGGV00FVGGUGGG00GEHGNHHF00HHHHVHHH00IE44444E00J72222IC00KHIKOKIH00LGGGGGGV00MHRLLHHH00NHHPLJHH00OEHHHHHE00PUHHUGGG00QEHHHLID00RUHHUKIH00SFGGE11U00TV44444400UHHHHHHE00VHHHHHA400WHHHLLLA00XHHA4AHH00YHHHA44400ZV1248GV00[E88888E00\\GG8421100]E22222E00^4AH000000_0000000V0`840000000a00E1FHF00bGGMPHHU00c00EGGHE00d11DJHHF00e00EHVGE00f698S88800g00FHHHF1EhGGMPHHH00i40C444E00j2062222ICkGGIKOKI00lC44444E00m00QLLLL00n00MPHHH00o00EHHHE00p00UHHHUGGq00FHHHF11r00MPGGG00s00FGE1U00t88S889600u00HHHJD00v00HHHA400w00HHLLA00x00HA4AH00y00HHHHF1Ez00V248V00{344O44300|444444440}O44344O00~008L20000≡0V0V0V000✱0LEVEL000°CIC000000×0HA4AH000';
const PIXEL_FAMILY = "'Text Art Pixel', ui-monospace, monospace";
let pixelGlyphs = null;
function pixelGlyph(cp) {
  if (!pixelGlyphs) {
    pixelGlyphs = new Map(); const A = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
    for (let i = 0; i < PIXEL_FONT_DATA.length; i += 10) pixelGlyphs.set(PIXEL_FONT_DATA.codePointAt(i), Array.from(PIXEL_FONT_DATA.slice(i + 1, i + 10), c => A.indexOf(c)));
  }
  return pixelGlyphs.get(cp);
}
/* fractional rectangles [x, y, w, h] of the block elements U+2580-259F (cell = 1 × 1) */
const BLOCK_RECTS = (() => {
  const h = 0.5, q = [[0, 0, h, h], [h, 0, h, h], [0, h, h, h], [h, h, h, h]];   // UL UR LL LR
  const R = {}, e = k => [[0, 1 - k / 8, 1, k / 8]];
  R[0x2580] = [[0, 0, 1, h]]; for (let k = 1; k <= 8; k++) R[0x2580 + k] = e(k);
  for (let k = 1; k <= 7; k++) R[0x2588 + k] = [[0, 0, (8 - k) / 8, 1]];
  R[0x2590] = [[h, 0, h, 1]]; R[0x2594] = [[0, 0, 1, 1 / 8]]; R[0x2595] = [[7 / 8, 0, 1 / 8, 1]];
  const Q = { 0x2596: [2], 0x2597: [3], 0x2598: [0], 0x2599: [0, 2, 3], 0x259A: [0, 3], 0x259B: [0, 1, 2], 0x259C: [0, 1, 3], 0x259D: [1], 0x259E: [1, 2], 0x259F: [1, 2, 3] };
  for (const k in Q) R[k] = Q[k].map(i => q[i]);
  return R;
})();
const BOX_ARMS = { 0x2500: 'lr', 0x2502: 'ud', 0x250C: 'rd', 0x2510: 'ld', 0x2514: 'ru', 0x2518: 'lu', 0x251C: 'udr', 0x2524: 'udl', 0x252C: 'lrd', 0x2534: 'lru', 0x253C: 'lrud', 0x2574: 'l', 0x2575: 'u', 0x2576: 'r', 0x2577: 'd' };
const DOT_SIZES = { 0xB7: 0.16, 0x2219: 0.16, 0x2022: 0.3, 0x25CF: 0.62, 0x25AA: 0.3, 0x25A0: 0.7 };
/* pushes the rectangles of one character in the cell (x0, y0, cw × ch) to out; false if the font does not have it */
function pixelCharRects(cp, x0, y0, cw, ch, out) {
  const B = BLOCK_RECTS[cp];
  if (B) { for (const [x, y, w, h] of B) out.push(x0 + x * cw, y0 + y * ch, w * cw, h * ch); return true; }
  const p = Math.min(cw / 6, ch / 10), P = p >= 1 ? Math.floor(p) : p;   // pixel size: whole pixels when there is room
  if (cp >= 0x2591 && cp <= 0x2593) {   // shades: an even pattern of pixels over the whole cell
    const nx = Math.max(1, Math.round(cw / P)), ny = Math.max(1, Math.round(ch / P)), sx = cw / nx, sy = ch / ny;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const on = cp === 0x2591 ? (x % 2 === 0 && y % 2 === 0) : cp === 0x2592 ? ((x + y) % 2 === 0) : !(x % 2 === 1 && y % 2 === 1);
      if (on) out.push(x0 + x * sx, y0 + y * sy, sx, sy);
    }
    return true;
  }
  if (cp >= 0x2800 && cp <= 0x28FF) {   // braille: 2 × 4 square dots
    const bits = cp - 0x2800, dw = cw / 2, dh = ch / 4, s = Math.max(P, Math.min(dw, dh) * 0.55);
    for (let j = 0; j < 8; j++) if (bits & (1 << j)) { const [dx, dy] = BRAILLE_POS[j]; out.push(x0 + dx * dw + (dw - s) / 2, y0 + dy * dh + (dh - s) / 2, s, s); }
    return true;
  }
  const arms = BOX_ARMS[cp];
  if (arms) {
    const t = Math.max(1, P), cx = x0 + Math.round((cw - t) / 2), cy = y0 + Math.round((ch - t) / 2);
    if (arms.includes('l')) out.push(x0, cy, cx - x0 + t, t);
    if (arms.includes('r')) out.push(cx, cy, x0 + cw - cx, t);
    if (arms.includes('u')) out.push(cx, y0, t, cy - y0 + t);
    if (arms.includes('d')) out.push(cx, cy, t, y0 + ch - cy);
    return true;
  }
  const dot = DOT_SIZES[cp];
  if (dot) { const s = Math.max(P, Math.round(Math.min(cw, ch) * dot / P) * P); out.push(x0 + (cw - s) / 2, y0 + (ch - s) / 2, s, s); return true; }
  const G = pixelGlyph(cp); if (!G) return false;
  const ox = x0 + (p >= 1 ? Math.round((cw - 5 * P) / 2) : (cw - 5 * P) / 2), oy = y0 + (p >= 1 ? Math.round((ch - 9 * P) / 2) : (ch - 9 * P) / 2);
  for (let y = 0; y < 9; y++) {
    const row = G[y]; if (!row) continue;
    for (let x = 0; x < 5;) {   // runs of lit pixels as one rectangle
      if (!(row & (16 >> x))) { x++; continue; }
      let e = x; while (e < 5 && (row & (16 >> e))) e++;
      out.push(ox + x * P, oy + y * P, (e - x) * P, P); x = e;
    }
  }
  return true;
}
/* draws the characters of a result with the pixel font (skip(c): cells to leave out) */
function drawPixelText(ctx, res, S, cw, ch, X, Y, skip) {
  const cp = res.cp, missing = [], R = [];
  for (const [k, list] of groupsOf(res, skip)) {
    ctx.fillStyle = hex6(k); ctx.beginPath();
    for (const c of list) {
      R.length = 0;
      if (!pixelCharRects(cp[c], X(c), Y(c), cw, ch, R)) { missing.push(c); continue; }
      for (let i = 0; i < R.length; i += 4) ctx.rect(R[i], R[i + 1], R[i + 2], R[i + 3]);
    }
    ctx.fill();
  }
  if (missing.length) {   // not in the font (katakana, emoji…): the system font
    ctx.font = Math.max(1, Math.min(cw / 0.6, ch / 1.1)) + 'px ' + FONTS.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const c of missing) { const o = c * 3; ctx.fillStyle = hex6((res.fg[o] << 16) | (res.fg[o + 1] << 8) | res.fg[o + 2]); ctx.fillText(chr(cp[c]), X(c) + cw / 2, Y(c) + ch / 2); }
  }
}
