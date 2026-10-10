/* =====================================================================
   Coloured ANSI text import: terminal art (.ans, .txt with escape codes, pasted ANSI) → a coloured text source
   Classic .ans files are CP437 bytes that wrap at 80 columns and may end with a SAUCE record; newer ones are UTF-8.
   The colours can then be kept ("Original colours"), mapped to app / retro palettes, greyscale, one colour or a gradient.
   ===================================================================== */
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
/* the 16 colours ANSI art was drawn with (VGA text mode) */
const VGA16 = [[0, 0, 0], [170, 0, 0], [0, 170, 0], [170, 85, 0], [0, 0, 170], [170, 0, 170], [0, 170, 170], [170, 170, 170],
  [85, 85, 85], [255, 85, 85], [85, 255, 85], [255, 255, 85], [85, 85, 255], [255, 85, 255], [85, 255, 255], [255, 255, 255]];
const hasAnsiCodes = t => /\x1b\[[0-9;?]*[A-Za-z]/.test(t);
/* bytes of a text file → { text, ansi } (ansi = null for plain text) */
async function readTextArt(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()), ext = (String(file.name || '').split('.').pop() || '').toLowerCase();
  return decodeTextArt(bytes, ext);
}
function decodeTextArt(bytes, ext) {
  let end = bytes.length;
  const sub = bytes.lastIndexOf(0x1a); if (sub >= 0 && end - sub <= 256 + 128 * 5) end = sub;   // SAUCE record and comments after ^Z
  const body = bytes.subarray(0, end);
  // UTF-8 unless it is not valid UTF-8, or the old DOS reading (CP437) gives more block / line characters
  let text = null, cp437 = false;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch (e) {}
  if (text == null || body.some(b => b >= 0x80)) {
    let dos = ''; for (const b of body) dos += b < 128 ? String.fromCharCode(b) : CP437_HIGH[b - 128];
    const art = s => (s.match(/[\u2500-\u259f]/g) || []).length;
    if (text == null || art(dos) > art(text)) { text = dos; cp437 = true; }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!hasAnsiCodes(text)) return { text, ansi: null };
  const ansi = ansiParse(text, cp437 || ext === 'ans' ? 80 : 0);
  return { text: ansiPlain(ansi), ansi };
}
/* Escape-coded text → a grid: cp per cell, fg / bg as 0xRRGGBB or -1 (= the default colour). wrap: columns after which
   the cursor wraps (classic ANSI art: 80; 0 = no wrapping). */
function ansiParse(text, wrap) {
  const rowsCp = [], rowsFg = [], rowsBg = [];
  let x = 0, y = 0, fg = -1, bg = -1, fgIdx = -1, bold = false, inv = false, sx = 0, sy = 0, maxX = 0;
  const pal = i => { const c = i < 16 ? VGA16[i] : ANSI256[i]; return (c[0] << 16) | (c[1] << 8) | c[2]; };
  const curFg = () => fgIdx >= 0 && fgIdx < 8 && bold ? pal(fgIdx + 8) : fg;
  const row = r => { while (rowsCp.length <= r) { rowsCp.push([]); rowsFg.push([]); rowsBg.push([]); } };
  const put = ch => {
    if (wrap && x >= wrap) { x = 0; y++; }
    row(y);
    let f = curFg(), b = bg; if (inv) { const t = f; f = b < 0 ? 0 : b; b = t < 0 ? 0xaaaaaa : t; }
    rowsCp[y][x] = ch.codePointAt(0); rowsFg[y][x] = f; rowsBg[y][x] = b;
    x++; if (x > maxX) maxX = x;
  };
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\x1b') {
      if (chars[i + 1] !== '[') { i++; continue; }   // other escapes: skip the next character
      let j = i + 2, params = '';
      while (j < chars.length && /[0-9;?]/.test(chars[j])) params += chars[j++];
      const cmd = chars[j]; i = j;
      const ps = params.replace(/\?/g, '').split(';').map(v => v === '' ? NaN : +v), n = isNaN(ps[0]) ? 1 : ps[0];
      if (cmd === 'm') {
        for (let k = 0; k < ps.length; k++) {
          const v = isNaN(ps[k]) ? 0 : ps[k];
          if (v === 0) { fg = bg = fgIdx = -1; bold = inv = false; }
          else if (v === 1) bold = true;
          else if (v === 22) bold = false;
          else if (v === 7) inv = true;
          else if (v === 27) inv = false;
          else if (v >= 30 && v <= 37) { fgIdx = v - 30; fg = pal(fgIdx); }
          else if (v >= 90 && v <= 97) { fgIdx = -1; fg = pal(v - 90 + 8); }
          else if (v === 39) { fg = fgIdx = -1; }
          else if (v >= 40 && v <= 47) bg = pal(v - 40);
          else if (v >= 100 && v <= 107) bg = pal(v - 100 + 8);
          else if (v === 49) bg = -1;
          else if ((v === 38 || v === 48) && ps[k + 1] === 5) { const c = pal(clamp(ps[k + 2] | 0, 0, 255)); if (v === 38) { fg = c; fgIdx = -1; } else bg = c; k += 2; }
          else if ((v === 38 || v === 48) && ps[k + 1] === 2) { const c = (clamp(ps[k + 2] | 0, 0, 255) << 16) | (clamp(ps[k + 3] | 0, 0, 255) << 8) | clamp(ps[k + 4] | 0, 0, 255); if (v === 38) { fg = c; fgIdx = -1; } else bg = c; k += 4; }
        }
      }
      else if (cmd === 'C') x += n;
      else if (cmd === 'D') x = Math.max(0, x - n);
      else if (cmd === 'A') y = Math.max(0, y - n);
      else if (cmd === 'B') y += n;
      else if (cmd === 'H' || cmd === 'f') { y = Math.max(0, (isNaN(ps[0]) ? 1 : ps[0]) - 1); x = Math.max(0, (isNaN(ps[1]) ? 1 : ps[1]) - 1); }
      else if (cmd === 's') { sx = x; sy = y; }
      else if (cmd === 'u') { x = sx; y = sy; }
      if (wrap && x > wrap) x = wrap;
      continue;
    }
    if (ch === '\r') { x = 0; continue; }
    if (ch === '\n') { x = 0; y++; row(y); continue; }
    if (ch === '\t') { const t = (Math.floor(x / 8) + 1) * 8; while (x < t) put(' '); continue; }
    if (ch < ' ' || ch === '\x7f') continue;
    put(ch);
  }
  while (rowsCp.length > 1 && !rowsCp[rowsCp.length - 1].length) { rowsCp.pop(); rowsFg.pop(); rowsBg.pop(); }
  const cols = Math.max(1, maxX), rows = Math.max(1, rowsCp.length), n = cols * rows;
  const cp = new Uint32Array(n).fill(32), fgA = new Int32Array(n).fill(-1), bgA = new Int32Array(n).fill(-1);
  for (let r = 0; r < rowsCp.length; r++) for (let c = 0; c < rowsCp[r].length; c++) {
    const i = r * cols + c;
    if (rowsCp[r][c] != null) { cp[i] = rowsCp[r][c]; fgA[i] = rowsFg[r][c]; bgA[i] = rowsBg[r][c]; }
  }
  return { cols, rows, cp, fg: fgA, bg: bgA };
}
/* open typed / pasted text art; escape codes in it make a coloured source */
function openTextArt(text, name, ansi, plain) {
  if (!ansi && text && hasAnsiCodes(text)) { ansi = ansiParse(text, 0); plain = ansiPlain(ansi); }
  if (!ansi) return setTextSource(text, name);
  setTextSource(plain, name.replace(/\.txt$/, '.ans'), ansi);
  if (S.colorMode === 'mono' || S.colorMode === 'gradient') applySettings({ colorMode: 'color' });
  toast(`Coloured ANSI art: ${ansi.cols}×${ansi.rows} characters. Change its colours in the Colour tab`);
}
const ansiPlain = a => { const lines = []; for (let y = 0; y < a.rows; y++) { let s = ''; for (let x = 0; x < a.cols; x++) s += chr(a.cp[y * a.cols + x] || 32); lines.push(s.replace(/\s+$/, '')); } return lines.join('\n'); };
/* the result of an imported ANSI grid with the colour settings */
function ansiResult(a, S) {
  const { cols, rows } = a, n = cols * rows, FG = hexToRgb(S.fg), BG = hexToRgb(S.bg), GA = hexToRgb(S.gradA), GB = hexToRgb(S.gradB);
  const res = { cols, rows, mode: 'text', cp: a.cp.slice(), fg: new Uint8ClampedArray(n * 3), bgc: null, bits: null, val: null, uniform: false };
  const CM = S.colorMode, dir = S.textGradient === 'horizontal' ? 1 : S.textGradient === 'diagonal' ? 2 : 0;
  const hasBg = CM !== 'mono' && CM !== 'gradient' && a.bg.some(v => v >= 0);
  if (hasBg) res.bgc = new Uint8ClampedArray(n * 3);
  const put = (arr, o, r, g, b) => {
    if (CM === 'gray') { const l = 0.299 * r + 0.587 * g + 0.114 * b; arr[o] = arr[o + 1] = arr[o + 2] = l; }
    else if (CM === 'app') { const c = appColour(paletteKey(S), r, g, b); arr[o] = c[0]; arr[o + 1] = c[1]; arr[o + 2] = c[2]; }
    else { arr[o] = r; arr[o + 1] = g; arr[o + 2] = b; }
  };
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    if (CM === 'mono') { res.fg[o] = FG[0]; res.fg[o + 1] = FG[1]; res.fg[o + 2] = FG[2]; }
    else if (CM === 'gradient') {
      const x = i % cols, y = (i / cols) | 0, tx = cols > 1 ? x / (cols - 1) : 0, ty = rows > 1 ? y / (rows - 1) : 0, t = dir === 0 ? ty : dir === 1 ? tx : (tx + ty) / 2;
      for (let k = 0; k < 3; k++) res.fg[o + k] = GB[k] + (GA[k] - GB[k]) * t;
    } else {
      const f = a.fg[i]; if (f < 0) put(res.fg, o, FG[0], FG[1], FG[2]); else put(res.fg, o, f >> 16, (f >> 8) & 255, f & 255);
      if (hasBg) { const b = a.bg[i]; if (b < 0) put(res.bgc, o, BG[0], BG[1], BG[2]); else put(res.bgc, o, b >> 16, (b >> 8) & 255, b & 255); }
    }
  }
  res.uniform = CM === 'mono';
  return res;
}
