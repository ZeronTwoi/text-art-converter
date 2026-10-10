'use strict';
/* =====================================================================
   Text Art Studio: offline image / GIF / video → text-art converter
   Single file, no network. Includes a GIF decoder + encoder, a ZIP
   writer and a BMP writer so it works without any libraries.
   ===================================================================== */

/* ---------------- helpers ---------------- */
/** @type {(s: string, r?: ParentNode) => any} */
const $ = (s, r = document) => r.querySelector(s);
/** @type {(s: string, r?: ParentNode) => any[]} */
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const nextTick = () => new Promise(r => setTimeout(r, 0));
function hexToRgb(h) {
  h = String(h || '#000').replace('#', '');
  if (h.length === 3) h = h.replace(/./g, c => c + c);
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lumRGB = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const hex6 = k => '#' + k.toString(16).padStart(6, '0');
const escHTML = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtTime(t) { if (!isFinite(t) || t < 0) t = 0; const m = Math.floor(t / 60); return m + ':' + (t - m * 60).toFixed(2).padStart(5, '0'); }
function fmtBytes(n) { if (n == null) return ''; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
function toast(msg, kind) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + (kind || '');
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 5000 : 2600);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); return ok;
}
const canvasToBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Encoding ' + type + ' failed')), type, q));

/* ---------------- constants ---------------- */
const CHARSETS = {
  standard: { name: 'Standard  .:-=+*#%@', chars: ' .:-=+*#%@' },
  detailed: { name: 'Detailed (70 chars)', chars: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
  smooth: { name: 'Smooth (no lines)  .:itCG@', chars: ' .,:;i1tfLCG08@' },   // round letters: no - = streaks
  blocks: { name: 'Shade blocks  ░▒▓█', chars: ' ░▒▓█' },
  simple: { name: 'Simple  .oO@', chars: ' .oO@' },
  dots: { name: 'Dots  ·•●', chars: ' ·•●' },
  lines: { name: 'Lines  -=≡', chars: ' -=≡' },
  stars: { name: 'Stars  .+*✱', chars: ' .+*✱' },
  binary: { name: 'Binary  01', chars: ' 01' },
  katakana: { name: 'Katakana (Matrix)', chars: ' ･ｰﾞｨｧｪｯｬｭｮｲｱｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ' },
  custom: { name: 'Custom…', chars: '' },
};
const MODES = {
  braille:  { name: 'Braille',     icon: '⣿⣦', sx: 2, sy: 4, shapes: true, hint: 'Each character is a 2×4 grid of dots. Highest detail per character.' },
  ascii:    { name: 'ASCII',       icon: '@%#', sx: 1, sy: 1, hint: 'Brightness picks a character from a density ramp.' },
  glyph:    { name: 'Shape',       icon: 'A/a', sx: 4, sy: 8, hint: 'Picks the character whose shape best matches each cell. Sharper lines than a ramp.' },
  edge:     { name: 'Edges',       icon: '/|\\', sx: 2, sy: 2, hint: 'Line drawing with / | \\ - that follow each edge. Adjust with Outlines in Edges & depth.' },
  half:     { name: 'Half block',  icon: '▀▄', sx: 1, sy: 2, shapes: true, hint: '2 pixels per character (▀ ▄). With colour this is a true-colour pixel image.' },
  quad:     { name: 'Quadrant',    icon: '▛▟', sx: 2, sy: 2, shapes: true, hint: '2×2 block pixels per character (▘▝▖▗ …).' },
  halftone: { name: 'Halftone',    icon: '·•●', sx: 1, sy: 2, shapes: true, hint: 'Dot size follows brightness, like print halftone.' },
  word:     { name: 'Text fill',   icon: 'Tx', sx: 1, sy: 1, hint: 'Your own text forms the picture.' },
  emoji:    { name: 'Emoji',       icon: '🟩🟥', sx: 1, sy: 1, wide: true, hint: 'A mosaic of emoji: every two columns become the emoji closest in colour (emoji are two characters wide in chat apps and terminals).' },
  text:     { name: 'Text', icon: 'T', sx: 1, sy: 1 },
};
const FONTS = {
  mono: "ui-monospace, 'Cascadia Mono', 'Cascadia Code', Consolas, 'DejaVu Sans Mono', Menlo, 'Segoe UI Symbol', monospace",
  consolas: "Consolas, 'Segoe UI Symbol', monospace",
  courier: "'Courier New', Courier, 'Segoe UI Symbol', monospace",
  lucida: "'Lucida Console', Monaco, 'Segoe UI Symbol', monospace",
  dejavu: "'DejaVu Sans Mono', 'Segoe UI Symbol', monospace",
  symbol: "'Segoe UI Symbol', 'Segoe UI', sans-serif",
  pixel: "'Text Art Pixel', ui-monospace, monospace",   // the built-in pixel font (drawn by drawPixelText, not by the browser)
};
/* fontFamily 'custom': any installed font by name (letters, digits, spaces and - only), monospace as fallback */
const fontCss = S => { const c = S.fontFamily === 'custom' && String(S.customFont || '').replace(/[^\w \-]/g, '').trim(); return c ? `'${c}', 'Segoe UI Symbol', monospace` : FONTS[S.fontFamily] || FONTS.mono; };
/* Where copied text will be pasted.
   wrap: 'fence' = ``` code block (monospace), 'indent' = 4-space code block,
         'none' = shown in a proportional font, 'mono' = monospace editor.
   phoneCols: roughly how many monospace characters fit one line on a phone before wrapping. */
const PLATFORMS = {
  discord:   { name: 'Discord', limit: 2000, limitNote: '4,000 with Nitro', wrap: 'fence', phoneCols: 42, deskCols: 90, ansi: true, theme: 'dark' },
  whatsapp:  { name: 'WhatsApp', limit: 65536, wrap: 'fence', phoneCols: 30, deskCols: 60, theme: 'light' },
  telegram:  { name: 'Telegram', limit: 4096, wrap: 'fence', phoneCols: 34, deskCols: 60, theme: 'light' },
  slack:     { name: 'Slack', limit: 40000, wrap: 'fence', phoneCols: 40, deskCols: 100, theme: 'light' },
  reddit:    { name: 'Reddit', limit: 10000, wrap: 'indent', phoneCols: 42, deskCols: 80, theme: 'light' },
  x:         { name: 'X / Twitter', limit: 280, limitNote: 'more with Premium', wrap: 'none', phoneCols: 30, deskCols: 40, weighted: true, theme: 'light' },
  instagram: { name: 'Instagram / TikTok / Facebook', limit: 2200, wrap: 'none', phoneCols: 28, deskCols: 40, theme: 'light' },
  email:     { name: 'Email / Word / Google Docs', limit: 0, wrap: 'none', phoneCols: 0, soft: true, theme: 'light' },
  plain:     { name: 'Notepad / code editor / terminal', limit: 0, wrap: 'mono', phoneCols: 0 },
};

const DEFAULTS = {
  mode: 'braille', cols: 120, charAspect: 2, fontSize: 10,
  charset: 'standard', customChars: ' .:-=+*#%@', sortRamp: false, brailleBlank: 'braille',
  glyphSet: 'ascii', glyphCustom: ' .,:;/\\|-_=+*#', edgeThreshold: 0.22, edgeFill: true, emojiSet: 'blocks',
  wordText: 'TEXT ART STUDIO ', wordFillAll: false,
  brightness: 0, contrast: 0, gamma: 1, saturation: 1, threshold: 0.5, edge: 0, sharpen: 0, outline: 0.45, outlineWidth: 1, outlineDir: true, fill: 1, localContrast: 0, bgFade: 0, dither: 'floyd', invert: false, autoLevels: false,
  colorMode: 'mono', fg: '#e8e6e3', bg: '#0b0d12', gradA: '#14123a', gradB: '#7cf7c4', bgMode: 'solid',
  renderStyle: 'shapes', dotShape: 'circle', dotSize: 0.85, fontFamily: 'mono', customFont: '', margin: 0, textGradient: 'vertical',
  rotate: 0, flipH: false, flipV: false, cropL: 0, cropR: 0, cropT: 0, cropB: 0,
  platform: 'discord', shareOptimize: false, shareTarget: 'phone', shareSplit: false, shareColor: false, shareTheme: 'auto', calib: {},
  appPalette: 'discord', exportGoal: 'chat', customPalette: '#1a1c2c #5d275d #b13e53 #ef7d57 #ffcd75 #a7f070 #38b764 #257179 #29366f #3b5dc9 #41a6f6 #73eff7 #f4f4f4 #94b0c2 #566c86 #333c57', customPaletteTone: false,
  captionTop: '', captionBottom: '', captionStyle: 'plain', captionBox: true, captionColor: '#ffffff',
  exportScale: 1, quality: 0.82, gifFps: 12, frameStep: 1, gifColors: 128, gifDiff: true, gifDither: false, gifPalette: 'frame', videoFps: 30, videoBitrate: 6, includeAudio: true, animRepeat: 1, playOrder: 'forward', playSpeed: 1, loopFade: 0,
  layerOn: false, layerX: 0.82, layerY: 0.82, layerSize: 0.25, layerOpacity: 1, layerBlend: 'source-over',
};
const TONE_KEYS = ['brightness', 'contrast', 'gamma', 'saturation', 'threshold', 'edge', 'sharpen', 'invert', 'autoLevels'];
const EDGE_KEYS = ['outline', 'outlineWidth', 'outlineDir', 'fill', 'localContrast', 'bgFade'];
/* The built-in looks (on top of PRESET_BASE). Tuned on portraits, animals, landscapes, dark and pale pictures, logos
   and tiny images at 50, 100 and 160 characters: auto levels adapts every look to the picture's own light. */
const PRESETS = {
  'Braille: classic': { mode: 'braille', colorMode: 'mono', fg: '#e8e6e3', bg: '#0b0d12', dither: 'atkinson', renderStyle: 'shapes', localContrast: 0.3, outline: 0.3 },
  'Braille: colour': { mode: 'braille', colorMode: 'color', bg: '#000000', dither: 'atkinson', saturation: 1.3, gamma: 1.7, renderStyle: 'shapes', outline: 0.2, localContrast: 0.15 },
  'ASCII: detailed': { mode: 'ascii', charset: 'detailed', colorMode: 'mono', fg: '#e8e6e3', bg: '#0b0d12', dither: 'none', outline: 0, localContrast: 0.2 },
  'ASCII: colour': { mode: 'ascii', charset: 'smooth', sortRamp: true, colorMode: 'color', bg: '#000000', bgMode: 'cell', dither: 'none', saturation: 1.3, gamma: 1.5, outline: 0, localContrast: 0.2 },
  'Terminal green': { mode: 'ascii', charset: 'smooth', sortRamp: true, colorMode: 'mono', fg: '#33ff77', bg: '#03140a', dither: 'none', outline: 0, localContrast: 0.3, gamma: 1.1 },
  'Matrix': { mode: 'ascii', charset: 'katakana', sortRamp: true, colorMode: 'gradient', gradA: '#1f8f40', gradB: '#eafff0', bg: '#000c04', dither: 'none', fontFamily: 'mono', gamma: 1.5, outline: 0, localContrast: 0.3 },
  'Pixel art (half blocks)': { mode: 'half', colorMode: 'color', bg: '#000000', renderStyle: 'shapes', saturation: 1.25, contrast: 0.08, outline: 0.12 },
  'Quadrant mosaic': { mode: 'quad', colorMode: 'color', bg: '#000000', renderStyle: 'shapes', saturation: 1.15, outline: 0.1 },
  'Newspaper (shape match)': { mode: 'glyph', glyphSet: 'ascii', colorMode: 'mono', fg: '#161616', bg: '#f3efe6', gamma: 1.5, outline: 0.25, localContrast: 0.3 },
  'Pencil sketch (edges)': { mode: 'edge', colorMode: 'mono', fg: '#2a2a2a', bg: '#fbfaf7', outline: 0.35, edgeFill: false, edgeThreshold: 0.3, charset: 'standard' },
  'Line art (outlines only)': { mode: 'braille', colorMode: 'mono', fg: '#e8e6e3', bg: '#0b0d12', outline: 0.45, fill: 0, renderStyle: 'shapes' },
  'Comic (outlines + shading)': { mode: 'braille', colorMode: 'mono', fg: '#e8e6e3', bg: '#0b0d12', outline: 0.45, fill: 0.75, localContrast: 0.35, dither: 'atkinson', gamma: 1.1, renderStyle: 'shapes' },
  'ASCII sketch': { mode: 'ascii', charset: 'smooth', sortRamp: true, colorMode: 'mono', fg: '#e8e6e3', bg: '#0b0d12', outline: 0.5, fill: 0.5, dither: 'none', localContrast: 0.2 },
  'Halftone print': { mode: 'halftone', colorMode: 'mono', fg: '#151515', bg: '#f4efe4', dotShape: 'circle', dotSize: 1, renderStyle: 'shapes', gamma: 1.35, outline: 0, localContrast: 0.25 },
  'Pop-art dots': { mode: 'halftone', colorMode: 'color', bg: '#fff7e8', dotShape: 'circle', dotSize: 1.05, renderStyle: 'shapes', saturation: 1.6, gamma: 0.9, contrast: 0.15, outline: 0, localContrast: 0.2 },
  'Lyrics poster (text fill)': { mode: 'word', colorMode: 'color', wordFillAll: true, bg: '#000000', saturation: 1.4, gamma: 1.7, outline: 0 },
  'Shade blocks': { mode: 'ascii', charset: 'blocks', colorMode: 'gradient', gradA: '#1b1035', gradB: '#ffd27a', bg: '#0b0816', dither: 'floyd', outline: 0 },
  'Sepia photo': { mode: 'braille', colorMode: 'gradient', gradA: '#7a5230', gradB: '#fbecd0', bg: '#140c06', dither: 'atkinson', renderStyle: 'shapes', localContrast: 0.3, outline: 0.2, gamma: 1.35 },
  'Ink on paper': { mode: 'ascii', charset: 'smooth', sortRamp: true, colorMode: 'mono', fg: '#1d1b18', bg: '#f7f3ea', dither: 'none', outline: 0, localContrast: 0.3 },
  'Blueprint': { mode: 'braille', colorMode: 'mono', fg: '#dbe9ff', bg: '#0d2b5e', dither: 'atkinson', renderStyle: 'shapes', fill: 0.15, outline: 0.5 },
  'Neon glow': { mode: 'braille', colorMode: 'color', bg: '#000000', dither: 'atkinson', renderStyle: 'shapes', fill: 0.2, outline: 0.55, saturation: 1.8, gamma: 1.6 },
  'Stencil poster': { mode: 'half', colorMode: 'mono', fg: '#111111', bg: '#f4c542', dither: 'none', renderStyle: 'shapes', outline: 0.3, localContrast: 0.4 },
  'Synthwave': { mode: 'quad', colorMode: 'gradient', gradA: '#2d0b59', gradB: '#ff4fd8', bg: '#12002b', renderStyle: 'shapes', outline: 0.15, contrast: 0.1 },
  'Game Boy': { mode: 'half', colorMode: 'app', appPalette: 'gameboy', bg: '#0f380f', renderStyle: 'shapes', contrast: 0.15, outline: 0.2 },
  'Commodore 64': { mode: 'quad', colorMode: 'app', appPalette: 'c64', bg: '#352879', renderStyle: 'shapes', saturation: 1.3, outline: 0.15 },
  'Amber terminal': { mode: 'ascii', charset: 'smooth', sortRamp: true, colorMode: 'app', appPalette: 'amber', bg: '#1a0d00', dither: 'none', outline: 0, localContrast: 0.3 },
  'Emoji mosaic': { mode: 'emoji', emojiSet: 'blocks', colorMode: 'color', bg: '#16161a', saturation: 1.2, outline: 0 },
};
const BRAILLE_BIT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];   // [dy][dx]
const BRAILLE_POS = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]]; // bit j -> [dx,dy]
const QUAD_CHARS = Array.from(' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█');   // bit 1=TL 2=TR 4=BL 8=BR
const HALF_CHARS = Array.from(' ▀▄█');              // bit 1=top 2=bottom
const HALFTONE_RAMP = Array.from(' .·•●');

/* ---------------- settings state ---------------- */
const STORE_KEY = 'textArtStudio.settings.v1';
const S = Object.assign({}, DEFAULTS);
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved) for (const k in DEFAULTS) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) S[k] = saved[k];
} catch (e) { /* storage unavailable */ }
if (!MODES[S.mode] || S.mode === 'text') S.mode = DEFAULTS.mode;
function saveSettings() {
  clearTimeout(saveSettings.t);
  saveSettings.t = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }, 300);
}

