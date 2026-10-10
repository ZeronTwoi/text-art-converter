/* =====================================================================
   Your own palette: take it from the picture, paste hex colours (e.g. from lospec.com), load .hex / .gpl,
   edit single colours. Used by "App & retro colours" like the built-in palettes.
   ===================================================================== */
/* the palette name appColour understands for settings S */
function paletteKey(S) { return S.appPalette === 'custom' ? (S.customPaletteTone ? 'custom~:' : 'custom:') + S.customPalette : S.appPalette; }
const customPals = new Map();
function customPal(key) {
  let P = customPals.get(key);
  if (!P) {
    const tone = key.startsWith('custom~:'), cols = parsePaletteText(key.slice(key.indexOf(':') + 1));
    if (!cols.length) cols.push([0, 0, 0], [255, 255, 255]);
    if (tone) cols.sort((a, b) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) - (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]));
    P = { tone, cols };
    if (customPals.size > 16) customPals.clear();
    customPals.set(key, P);
  }
  return P;
}
/* colours in any common form: hex (#abc, #aabbcc, aabbcc), GIMP .gpl lines ("R G B name"); at most 256, no repeats */
function parsePaletteText(text) {
  const out = [], seen = new Set(), add = (r, g, b) => { const k = (r << 16) | (g << 8) | b; if (!seen.has(k) && out.length < 256) { seen.add(k); out.push([r, g, b]); } };
  for (const line of String(text || '').split(/\r?\n/)) {
    const gpl = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/.exec(line);
    if (gpl) { add(+gpl[1] & 255, +gpl[2] & 255, +gpl[3] & 255); continue; }
    if (/^\s*(GIMP|Name:|Columns:|#\s)/i.test(line)) continue;
    for (const m of line.matchAll(/#?\b([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
      let h = m[1]; if (h.length === 3) h = h.replace(/./g, c => c + c);
      const n = parseInt(h, 16); add(n >> 16, (n >> 8) & 255, n & 255);
    }
  }
  return out;
}
const paletteText = cols => cols.map(c => hex6((c[0] << 16) | (c[1] << 8) | c[2])).join(' ');
/* the main colours of the current picture (median cut) */
function paletteFromPicture(n) {
  const d = App.src && App.src.kind !== 'text' ? currentDrawable() : null; if (!d) return null;
  const k = Math.min(1, 200 / Math.max(d[1], d[2])), w = Math.max(1, Math.round(d[1] * k)), h = Math.max(1, Math.round(d[2] * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  drawTransformed(g, d[0], d[1], d[2], w, h, S);
  const H = rgbaHistogram(g.getImageData(0, 0, w, h).data, true), P = paletteFromHistogram(H.cnt, H.sr, H.sg, H.sb, n, false), cols = [];
  for (let i = 0; i < P.n; i++) { const o = (P.off + i) * 3; cols.push([P.pal[o], P.pal[o + 1], P.pal[o + 2]]); }
  return cols.sort((a, b) => (0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2]) - (0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2]));
}
function setCustomPalette(cols, msg) {
  if (!cols || !cols.length) return toast('No colours found', 'error');
  App.look = null; markLooks();
  applySettings({ colorMode: 'app', appPalette: 'custom', customPalette: paletteText(cols) });
  if (msg) toast(msg);
}
function buildPaletteUI() {
  const box = $('#palSwatches'); if (!box) return;
  const cols = parsePaletteText(S.customPalette), key = S.customPalette;
  if (box._key === key) return; box._key = key; box.textContent = '';
  cols.forEach((c, i) => {
    const s = document.createElement('span'), hx = hex6((c[0] << 16) | (c[1] << 8) | c[2]);
    s.className = 'swatch'; s.style.background = hx; s.title = hx + ' (click to change, ✕ removes)';
    s.innerHTML = `<input type="color" value="${hx}" aria-label="Colour ${i + 1}: ${hx}"><i role="button" aria-label="Remove ${hx}">✕</i>`;
    s.querySelector('input').addEventListener('change', e => { const n = cols.slice(); n[i] = hexToRgb(e.target.value); setCustomPalette(n); });
    s.querySelector('i').addEventListener('click', e => { e.preventDefault(); if (cols.length <= 2) return toast('A palette needs at least two colours'); setCustomPalette(cols.filter((_, j) => j !== i)); });
    box.appendChild(s);
  });
  const add = document.createElement('button'); add.className = 'swatch add'; add.textContent = '+'; add.title = 'Add a colour';
  add.addEventListener('click', () => setCustomPalette(cols.concat([[128, 128, 128]])));
  box.appendChild(add);
  $('#palCount').textContent = cols.length + ' colours';
}
function initPalettes() {
  $('#palFromPic').addEventListener('click', () => { const n = +$('#palN').value || 8, cols = paletteFromPicture(n); if (!cols) return toast('Open a picture first'); setCustomPalette(cols, `${cols.length} colours taken from the picture`); });
  $('#palPaste').addEventListener('click', async () => {
    let text = ''; try { text = await navigator.clipboard.readText(); } catch (e) {}
    if (!text) text = prompt('Paste colours (hex codes like #1a1c2c, e.g. from lospec.com):') || '';
    const cols = parsePaletteText(text); setCustomPalette(cols, cols.length ? `${cols.length} colours pasted` : '');
  });
  $('#palFile').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const cols = parsePaletteText(await f.text()); setCustomPalette(cols, `${cols.length} colours from ${f.name}`); });
  $('#palCopy').addEventListener('click', () => copyOrShow(S.customPalette, 'Palette copied as hex codes'));
  buildPaletteUI();
}
