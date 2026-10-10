/* =====================================================================
   Exports
   ===================================================================== */
const IMG_FORMATS = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 2;
  const ok = t => { try { return c.toDataURL(t).startsWith('data:' + t); } catch (e) { return false; } };
  const list = [{ label: 'PNG', mime: 'image/png', ext: 'png' }, { label: 'JPG', mime: 'image/jpeg', ext: 'jpg' }, { label: 'WEBP', mime: 'image/webp', ext: 'webp' }, { label: 'AVIF', mime: 'image/avif', ext: 'avif' }]
    .filter(f => f.mime === 'image/png' || ok(f.mime));
  list.push({ label: 'BMP', mime: 'image/bmp', ext: 'bmp', custom: true });
  return list;
})();
const VIDEO_FORMATS = (() => {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return [];
  const cands = [['WEBM', 'webm', ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']], ['MP4', 'mp4', ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4']]];
  const out = [];
  for (const [label, ext, list] of cands) {
    const m = list.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } });
    if (m) out.push({ label, ext, mime: m });
  }
  return out;
})();
function baseName() {
  const n = (App.src && App.src.name) || 'textart';
  return n.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 60) + '_' + (App.src && App.src.kind === 'text' ? 'text' : S.mode);
}
function safeScale(res, scale) {
  let s = scale, reduced = false;
  for (let i = 0; i < 40; i++) {
    const [w, h] = pictureSize(res.cols, res.rows, S, s);
    if (w <= 16000 && h <= 16000 && w * h <= 120e6) break;
    s *= 0.85; reduced = true;
  }
  if (reduced) toast(`Output too large, scale reduced to ${s.toFixed(2)}×`);
  return s;
}
function requireRes() { if (!App.res) { toast('Nothing to export yet'); return false; } return true; }
/* Copies, or (if the browser blocks the clipboard) shows the text selected for manual Ctrl+C. */
async function copyOrShow(text, okMsg) {
  if (await copyText(text)) { toast(okMsg); return; }
  const a = $('#copyArea'); a.value = text; $('#copyDialog').showModal(); a.focus(); a.select();
}
async function actCopyText() { if (!requireRes()) return; copyOrShow(resultText(App.res), 'Plain text copied. Paste it into a monospace editor such as Notepad'); }
/* Rich text with colours (HTML + plain text), for Word, Google Docs, Outlook, Gmail… */
async function actCopyHTML() {
  if (!requireRes()) return;
  const res = App.res, html = `<pre style="${preStyle(S)}color:${S.fg};background:${S.bgMode === 'transparent' ? 'transparent' : S.bg};padding:8px;white-space:pre">${resultHTMLInner(res)}</pre>`;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([resultText(res)], { type: 'text/plain' }) })]);
    toast('Copied with colours. Paste into Word, Google Docs or an email');
  } catch (e) { copyOrShow(resultText(res), 'Copied as plain text (this browser does not allow copying colours)'); }
}
async function actCopyANSI() { if (!requireRes()) return; copyOrShow(resultANSI(App.res), 'ANSI copied. Paste it into a true-colour terminal'); }

/* ---------- sharing to chat / social platforms ---------- */
const curPlatform = () => PLATFORMS[S.platform] || PLATFORMS.discord;
const targetCols = P => S.shareTarget === 'desktop' ? (P.deskCols || 0) : ((P.phoneCols && S.calib && S.calib[S.platform] && S.calib[S.platform].cols) || P.phoneCols || 0);
const shareColour = P => !!(P.ansi && S.shareColor);
const MAX_PARTS = 8;

/* Discord ```ansi blocks support 8 text colours. Pick by hue: brightness is already carried by the dots. */
const DISCORD_CSS = { 30: '#80848e', 31: '#dc322f', 32: '#859900', 33: '#b58900', 34: '#268bd2', 35: '#d33682', 36: '#2aa198', 37: '#ffffff' };
const DISCORD_BY_KEY = new Map(Object.entries(DISCORD_CSS).map(([c, h]) => [parseInt(h.slice(1), 16), +c]));
const DISCORD_HUES = [[31, 0], [33, 45], [32, 85], [36, 175], [34, 212], [35, 318], [31, 360]];
function discordCode(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 38 || mx < 45) return (mx + mn) / 2 < 100 ? 30 : 37;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  let best = 37, bd = Infinity;
  for (const [c, hh] of DISCORD_HUES) { const dd = Math.abs(h - hh); if (dd < bd) { bd = dd; best = c; } }
  return best;
}
/* One string per row. Colour rows are self-contained (each starts its own colour), so they can be split into separate messages. */
function shareRows(res, P, colour) {
  const { cols, rows, cp, fg } = res, out = new Array(rows);
  const brailleFix = P.wrap === 'none' && res.mode === 'braille';
  const codes = new Uint8Array(cols);
  for (let y = 0; y < rows; y++) {
    let s = '';
    if (!colour) {
      for (let x = 0; x < cols; x++) { let c = cp[y * cols + x] || 32; if (brailleFix && c === 32) c = 0x2800; s += chr(c); }
      out[y] = s; continue;
    }
    for (let x = 0; x < cols; x++) { const i = y * cols + x, o = i * 3; codes[x] = isBlankCp(cp[i]) ? 0 : (DISCORD_BY_KEY.get((fg[o] << 16) | (fg[o + 1] << 8) | fg[o + 2]) || discordCode(fg[o], fg[o + 1], fg[o + 2])); }
    // remove single-cell colour flickers: fewer colour codes = much shorter message
    for (let x = 1; x < cols - 1; x++) if (codes[x] && codes[x - 1] && codes[x - 1] === codes[x + 1] && codes[x] !== codes[x - 1]) codes[x] = codes[x - 1];
    let last = -1;
    for (let x = 0; x < cols; x++) {
      if (codes[x] && codes[x] !== last) { s += `\u001b[0;${codes[x]}m`; last = codes[x]; }
      s += chr(cp[y * cols + x] || 32);
    }
    out[y] = s;
  }
  return out;
}
function formatRows(rows, P, colour) {
  if (P.wrap === 'fence') return (colour ? '```ansi\n' : '```\n') + rows.join('\n') + '\n```';
  if (P.wrap === 'indent') return rows.map(l => '    ' + l).join('\n');
  return rows.join('\n');
}
function platformText(res, P, colour) { return formatRows(shareRows(res, P, colour), P, colour); }
function discordANSI(res) { return shareRows(res, PLATFORMS.discord, true).join('\n'); }
function platformLength(text, P) {
  let n = 0;
  for (const ch of text) { const c = ch.codePointAt(0); n += P.weighted && c > 0x10FF ? 2 : 1; }   // X counts most non-Latin characters double
  return n;
}
/* Splits into messages that each fit the limit (only when splitting is on). */
function shareParts(res, P, colour) {
  const rows = shareRows(res, P, colour);
  if (!P.limit || !S.shareSplit) return [formatRows(rows, P, colour)];
  const overhead = platformLength(formatRows([], P, colour), P);
  const parts = []; let cur = [], len = overhead;
  for (const r of rows) {
    const rl = platformLength(r, P) + 1 + (P.wrap === 'indent' ? 4 : 0);
    if (cur.length && len + rl > P.limit) { parts.push(formatRows(cur, P, colour)); cur = []; len = overhead; }
    cur.push(r); len += rl;
  }
  if (cur.length) parts.push(formatRows(cur, P, colour));
  return parts;
}
const partsFit = (parts, P) => !P.limit || (parts.length <= (S.shareSplit ? MAX_PARTS : 1) && parts.every(p => platformLength(p, P) <= P.limit));

/* Changes the MAIN settings (used by the single-issue fix buttons). */
function fitColsToLimit(P) {
  const d = currentDrawable(); if (!d || !P.limit || !App.res) return;
  let cols = Math.round(S.cols);
  for (let i = 0; i < 25 && cols > 2; i++) {
    const r = convert(d[0], d[1], d[2], Object.assign({}, S, { cols }));
    const parts = shareParts(r, P, shareColour(P));
    if (partsFit(parts, P)) break;
    const total = parts.reduce((a, p) => a + platformLength(p, P), 0), budget = P.limit * (S.shareSplit ? MAX_PARTS : 1);
    cols = Math.max(2, Math.min(cols - 1, Math.floor(cols * Math.sqrt(budget / total) * 0.98)));
  }
  applySettings({ cols });
  toast(`Width set to ${cols} characters to fit ${P.name}'s limit`);
}

/* Finds empty, uniform borders around the subject. Returns crop percentages or null. */
function autoTrimRect(src, sw, sh) {
  const k = Math.min(1, 200 / Math.max(sw, sh)), w = Math.max(8, Math.round(sw * k)), h = Math.max(8, Math.round(sh * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const hist = new Map(); let best = null, bestN = 0;
  const key = i => ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4) | (d[i + 3] < 128 ? 4096 : 0);
  const visit = i => { const kk = key(i), n = (hist.get(kk) || 0) + 1; hist.set(kk, n); if (n > bestN) { bestN = n; best = i; } };
  for (let x = 0; x < w; x++) { visit(x * 4); visit(((h - 1) * w + x) * 4); }
  for (let y = 0; y < h; y++) { visit(y * w * 4); visit((y * w + w - 1) * 4); }
  if (bestN < (2 * (w + h)) * 0.35) return null;   // borders aren't a uniform background
  const br = d[best], bg = d[best + 1], bb = d[best + 2], ba = d[best + 3];
  const differs = i => ba < 128 ? d[i + 3] >= 128 : (d[i + 3] >= 128 && Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) > 60);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (differs((y * w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const px = Math.round(w * 0.03), py = Math.round(h * 0.03);
  x0 = Math.max(0, x0 - px); y0 = Math.max(0, y0 - py); x1 = Math.min(w - 1, x1 + px); y1 = Math.min(h - 1, y1 + py);
  const r = { l: x0 / w * 100, t: y0 / h * 100, r: (w - 1 - x1) / w * 100, b: (h - 1 - y1) / h * 100 };
  if (r.l + r.r < 4 && r.t + r.b < 4) return null;   // nothing worth trimming
  for (const s of ['l', 'r', 't', 'b']) r[s] = Math.min(45, Math.round(r[s] * 2) / 2);
  return r;
}
function actAutoTrim() {
  const d = App.src && App.src.kind !== 'text' ? currentDrawable() : null;
  if (!d) return toast('Open an image first');
  const r = autoTrimRect(d[0], d[1], d[2]);
  if (!r) return toast('No empty borders found to trim');
  applySettings({ cropL: r.l, cropR: r.r, cropT: r.t, cropB: r.b });
  toast('Empty borders trimmed');
}

/* ---- "Fix all": derive platform-ready settings WITHOUT touching the main settings ----
   Keeps colours, tone, dithering, character set and font. Changes only what the platform forces:
   the style when the platform can't show it, the width (target device / length limit),
   plus border trim and sharpening when the picture gets much smaller. */
/* ---- chat theme (light/dark) and per-phone calibration ---- */
const CHAT_THEME = { dark: { fg: '#dbdee1', bg: '#313338' }, light: { fg: '#111111', bg: '#ffffff' } };
const chatTheme = P => S.shareTheme === 'auto' ? (P.theme || null) : S.shareTheme;
const calibFor = P => (S.calib && S.calib[S.platform]) || null;
/* true when bright parts of the picture get the characters (text is light on a dark background) */
const brightGetsInk = St => St.colorMode === 'mono' ? lumRGB(hexToRgb(St.bg)) <= lumRGB(hexToRgb(St.fg)) : lumRGB(hexToRgb(St.bg)) < 0.5;
const CAL_ASPECTS = [1.7, 2.0, 2.3, 2.6];
function ringRows(a) {   // a braille ring that is round only if one character cell is a (height / width)
  const C = 12, DW = C * 2, r = DW / 2 - 1, ky = a / 2;   // vertical dot spacing in units of horizontal dot spacing
  const DH = Math.ceil((2 * r + 2) / ky / 4) * 4, cx = DW / 2, cy = DH / 2 * ky, rows = [];
  for (let ry = 0; ry < DH / 4; ry++) {
    let s = '';
    for (let c = 0; c < C; c++) {
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        const x = c * 2 + dx + 0.5, y = (ry * 4 + dy + 0.5) * ky;
        if (Math.abs(Math.hypot(x - cx, y - cy) - r) < 0.8) bits |= BRAILLE_BIT[dy][dx];
      }
      s += String.fromCharCode(0x2800 + bits);
    }
    rows.push(s);
  }
  return rows;
}
function testCardRows() {
  const rows = ['TEST CARD: find the longest bar that stays on ONE line'];
  for (let n = 20; n <= 64; n += 4) rows.push(n + '⠀' + '⣿'.repeat(n));
  rows.push('Which ring looks most like a circle?');
  CAL_ASPECTS.forEach((a, k) => { rows.push('ABCD'[k] + ':'); rows.push(...ringRows(a)); });
  return rows;
}

/* ---- the share copy ----
   Always: match the chat's light/dark theme and the phone calibration (without these the picture
   turns into a negative or gets stretched). With "Fix all": also width, length, style and detail. */
function computeShare() {
  const P = curPlatform(), colour = shareColour(P);
  App.shareRes = App.res; App.shareSettings = null; App.shareChanges = null; App.shareAuto = [];
  App.shareParts = App.res ? shareParts(App.res, P, colour) : [];
  if (!App.src || App.src.kind === 'text' || !App.res) return;
  const d = currentDrawable(); if (!d) return;
  const o = Object.assign({}, S), changes = [], reasons = [], auto = [];
  let derived = false;
  const theme = chatTheme(P);
  if (theme) {
    o.fg = CHAT_THEME[theme].fg; o.bg = CHAT_THEME[theme].bg;
    if (brightGetsInk(o) !== brightGetsInk(S)) { derived = true; auto.push(`Light and dark are swapped for ${P.name}'s ${theme} theme. Without this the picture would look like a photo negative there.`); }
  }
  const cal = S.shareTarget === 'phone' ? calibFor(P) : null;
  if (cal && cal.aspect && Math.abs(cal.aspect - S.charAspect) > 0.04) {
    o.charAspect = cal.aspect; derived = true;
    auto.push(`Character shape ${S.charAspect} → ${cal.aspect} from your phone calibration, so the picture isn't stretched.`);
  }
  App.shareAuto = auto;
  if (!S.shareOptimize) {
    if (derived) { App.shareRes = convert(d[0], d[1], d[2], o); App.shareParts = shareParts(App.shareRes, P, colour); }
    return;
  }
  if (P.wrap === 'none' && o.mode !== 'braille') {
    changes.push(`Style: ${MODES[o.mode].name} → Braille, the only style that keeps its shape in ${P.name}'s normal font (your colours and tone are kept)`);
    o.mode = 'braille';
  }
  if (colour && (o.colorMode !== 'app' || o.appPalette !== 'discord')) { o.colorMode = 'app'; o.appPalette = 'discord'; changes.push("Colours: App colours (Discord's 8), so the copy matches what you see"); }
  let cols = Math.round(S.cols);
  const tc = targetCols(P);
  if (tc && cols > tc) { cols = tc; reasons.push(S.shareTarget === 'desktop' ? 'fits a desktop chat window' : cal ? 'fits your phone (calibrated)' : 'fits a phone screen without wrapping'); }
  o.cols = cols;
  let res = convert(d[0], d[1], d[2], o);
  // fit the length limit (or the split budget): text length grows with width², so scale by the square root
  for (let i = 0; i < 25 && P.limit && o.cols > 2; i++) {
    const parts = shareParts(res, P, colour);
    if (partsFit(parts, P)) break;
    const total = parts.reduce((a, p) => a + platformLength(p, P), 0), budget = P.limit * (S.shareSplit ? MAX_PARTS : 1);
    o.cols = Math.max(2, Math.min(o.cols - 1, Math.floor(o.cols * Math.sqrt(budget / total) * 0.98)));
    res = convert(d[0], d[1], d[2], o);
    const why = `stays under ${P.limit.toLocaleString()} characters${S.shareSplit ? ` per message (max ${MAX_PARTS} messages)` : ''}${colour ? ' including colour codes' : ''}`;
    if (!reasons.includes(why)) reasons.push(why);
  }
  const small = o.cols < S.cols * 0.8, phone = S.shareTarget === 'phone' && !!P.phoneCols;
  if (small || phone) {
    // give the subject the space and keep shapes readable on a small screen
    const tr = autoTrimRect(d[0], d[1], d[2]);
    if (small && tr && (tr.l > o.cropL + 1 || tr.r > o.cropR + 1 || tr.t > o.cropT + 1 || tr.b > o.cropB + 1)) {
      o.cropL = Math.max(o.cropL, tr.l); o.cropR = Math.max(o.cropR, tr.r); o.cropT = Math.max(o.cropT, tr.t); o.cropB = Math.max(o.cropB, tr.b);
      changes.push('Trimmed empty borders so the subject fills the narrow width');
    }
    const tw = [];
    if (!o.autoLevels) { o.autoLevels = true; tw.push('auto levels'); }
    if (o.sharpen < 0.8 && o.mode !== 'half') { o.sharpen = 0.8; tw.push('sharpen'); }
    if (o.outline < 0.6) { o.outline = 0.6; tw.push('stronger outlines'); }
    if (phone && (o.dither === 'floyd' || o.dither === 'noise')) { o.dither = 'atkinson'; tw.push('cleaner Atkinson dithering (fewer stray dots on small screens)'); }
    if (tw.length) changes.push(`Readability: ${tw.join(' + ')}`);
    res = convert(d[0], d[1], d[2], o);
    for (let i = 0; i < 10 && P.limit && o.cols > 2 && !partsFit(shareParts(res, P, colour), P); i++) { o.cols = Math.max(2, o.cols - Math.max(1, Math.round(o.cols * 0.05))); res = convert(d[0], d[1], d[2], o); }
  }
  if (o.cols !== Math.round(S.cols)) changes.unshift(`Width: ${Math.round(S.cols)} → ${o.cols} characters (${reasons.join(', ') || 'fits the platform'})`);
  App.shareRes = res; App.shareSettings = o; App.shareChanges = changes;
  App.shareParts = shareParts(res, P, colour);
}

/* ---- calibration dialog ---- */
function openCalibration() {
  const P = curPlatform(), dlg = $('#calDialog');
  $$('.calPlat', dlg).forEach(e => { e.textContent = P.name; });
  const sel = $('#calCols'); sel.innerHTML = '';
  const cur = calibFor(P), want = (cur && cur.cols) || P.phoneCols || 32;
  for (let n = 20; n <= 64; n += 4) { const o = document.createElement('option'); o.value = n; o.textContent = n + ' characters'; sel.appendChild(o); }
  sel.value = String(Math.max(20, Math.min(64, Math.round(want / 4) * 4)));
  const ca = cur && cur.aspect ? cur.aspect : 2.0;
  $$('input[name="calAspect"]', dlg).forEach((r, k) => { r.checked = Math.abs(CAL_ASPECTS[k] - ca) < 0.01; });
  $('#calReset').hidden = !cur;
  dlg.showModal();
}
function initCalibration() {
  const dlg = $('#calDialog');
  $('#calCopy').addEventListener('click', () => {
    const P = curPlatform();
    copyOrShow(formatRows(testCardRows(), P, false), `Test card copied. Send it to yourself in ${P.name} and look at it on your phone`);
  });
  $('#calCancel').addEventListener('click', () => dlg.close());
  $('#calSave').addEventListener('click', () => {
    const k = $$('input[name="calAspect"]', dlg).findIndex(r => r.checked);
    const entry = { cols: parseInt($('#calCols').value, 10), aspect: CAL_ASPECTS[k >= 0 ? k : 1] };
    applySettings({ calib: Object.assign({}, S.calib, { [S.platform]: entry }), shareTarget: 'phone' });
    dlg.close(); toast(`Saved: ${entry.cols} characters per line, shape ${entry.aspect} for ${curPlatform().name}`);
  });
  $('#calReset').addEventListener('click', () => {
    const c = Object.assign({}, S.calib); delete c[S.platform];
    applySettings({ calib: c }); dlg.close(); toast('Calibration removed');
  });
}

function shareChecks(res, St, optimized) {
  const P = curPlatform(), out = [], s = App.src, mode = res.mode, colour = shareColour(P);
  const canFix = s && s.kind !== 'text' && !optimized;
  const add = (lvl, msg, fix, alwaysFix) => out.push({ lvl, msg, fix: canFix || alwaysFix ? fix : null, fixable: !!fix && !alwaysFix });
  for (const m of App.shareAuto || []) add('ok', m);
  if (S.shareTarget === 'phone' && P.phoneCols && s && s.kind !== 'text') {
    const cal = calibFor(P);
    if (cal) add('ok', `Using your phone calibration for ${P.name}: ${cal.cols} characters per line, shape ${cal.aspect}.`);
    else add('info', `Phones draw braille at different sizes. A one-minute calibration makes the width and shape exact for your phone.`, { label: '📏 Calibrate my phone', fn: openCalibration }, true);
  }
  // 1. alignment / font
  if (P.wrap === 'none') {
    if (mode === 'braille') add('ok', `Braille keeps its shape in ${P.name}'s normal font. Blank cells are sent as invisible braille so they aren't collapsed.`);
    else add(P.soft ? 'warn' : 'bad', `${P.name} shows messages in a proportional font, so ${MODES[mode] ? MODES[mode].name : 'this'} art will lose its alignment${P.soft ? ' unless you change the font to a monospace one (e.g. Consolas) after pasting' : ''}.`,
      { label: 'Switch to Braille style', fn: () => applySettings({ mode: 'braille', brailleBlank: 'braille' }) });
  } else if (P.wrap === 'mono') add('ok', 'Paste into an editor that uses a monospace font (Notepad, VS Code, a terminal).');
  else add('ok', `Copied inside a ${P.wrap === 'fence' ? '``` code block' : '4-space code block'}, so ${P.name} shows it in a monospace font.`);
  if (mode === 'half' || mode === 'quad' || (mode === 'ascii' && St.charset === 'blocks'))
    add('warn', 'Block characters (▀ ▄ █ ░) are drawn at slightly different widths on some phones. Braille is the safest style.');
  if ((mode === 'ascii' && St.charset === 'katakana') || (mode === 'word' && /[^\u0000-ɏ⠀-⣿]/.test(St.wordText)))
    add('warn', 'Non-Latin characters can be wider than one cell on some devices and break alignment.');
  // 2. colour
  const colourful = !res.uniform || St.colorMode !== 'mono';
  if (P.ansi) {
    if (colour) {
      add('warn', 'Colour copy: shows only on Discord desktop and web, in 8 basic colours. The Discord mobile app shows it without colour.');
      if (St.colorMode === 'mono') add('warn', 'Colour mode is "Single colour", so the colour copy will be all one colour.', { label: 'Use App colours', fn: () => applySettings({ colorMode: 'app', appPalette: 'discord' }) });
      else if (!(St.colorMode === 'app' && St.appPalette === 'discord')) add('info', 'Tip: set Colour to "App colours" (Discord) to preview exactly the 8 colours this copy will have.', { label: 'Preview app colours', fn: () => applySettings({ colorMode: 'app', appPalette: 'discord' }) }, true);
    } else if (colourful) add('warn', 'Colours are lost in a normal copy. Tick "Colour copy" above for 8 basic Discord colours (desktop), or send a PNG / GIF / MP4 for full colour.');
  } else if (colourful) add('warn', 'Colours are lost: text messages only carry plain characters. Send a PNG, GIF or MP4 to keep colours.');
  // 3. animation (cannot be fixed in text)
  if (s && (s.kind === 'anim' || s.kind === 'video' || s.kind === 'webcam'))
    add('warn', 'Only the current frame is copied. Chat apps cannot play text animations. Send the GIF or MP4 export instead.');
  // 4. width on the target device
  const tc = targetCols(P), dev = S.shareTarget === 'desktop' ? 'desktop' : 'phone';
  if (tc && res.cols > tc)
    add('warn', `${res.cols} characters per line. On a ${dev}, lines longer than about ${tc} characters wrap and scramble the picture.`,
      { label: `Fit ${dev} width (${tc})`, fn: () => applySettings({ cols: tc }) });
  // 5. length limit / splitting
  if (P.limit) {
    const parts = shareParts(res, P, colour), lens = parts.map(p => platformLength(p, P)), maxLen = Math.max(...lens);
    const what = colour ? ' (colour codes count too)' : '';
    if (parts.length === 1) {
      if (lens[0] > P.limit) add('bad', `Too long: ${lens[0].toLocaleString()} characters${what}, but ${P.name} allows ${P.limit.toLocaleString()}${P.limitNote ? ' (' + P.limitNote + ')' : ''}. ${P.ansi ? 'Discord turns long pastes into a message.txt file, which shows no art and no colour.' : 'The message will be rejected or cut off.'}`,
        { label: 'Shrink to fit the limit', fn: () => fitColsToLimit(P) });
      else add('ok', `${lens[0].toLocaleString()} / ${P.limit.toLocaleString()} characters${what}: fits in one message.`);
      if (lens[0] > P.limit) out[out.length - 1].fix2 = { label: 'Split into messages instead', fn: () => applySettings({ shareSplit: true }) };
    } else if (parts.length <= MAX_PARTS && maxLen <= P.limit)
      add('ok', `Split into ${parts.length} messages (up to ${maxLen.toLocaleString()} characters each). Paste them one after another; they stack into the full picture with small gaps.`);
    else add('bad', `Even split, this needs ${parts.length} messages of up to ${maxLen.toLocaleString()} characters. Keep it to ${MAX_PARTS} or fewer.`, { label: 'Shrink to fit', fn: () => fitColsToLimit(P) });
  }
  return out;
}
/* The share checks may convert the picture again (chat theme, phone calibration, "Fix all"), so they are not
   redone on every frame: only while visible, after the settings stop changing (or every 0.5 s while playing). */
let shareTimer = 0;
function scheduleShareUI() {
  if (App.view === 'platform') { clearTimeout(shareTimer); shareTimer = 0; updateShareUI(true); return; }
  if ((S.exportGoal || 'chat') !== 'chat') { App.shareStale = true; return; }
  if (App.playing) { if (!shareTimer) shareTimer = setTimeout(() => { shareTimer = 0; updateShareUI(true); }, 500); return; }
  clearTimeout(shareTimer); shareTimer = setTimeout(() => { shareTimer = 0; updateShareUI(true); }, 120);
}
let shareLastUpdate = 0;
function updateShareUI(force) {
  App.shareStale = false;
  const box = $('#shareBox'); if (!box || !App.res) return;
  const now = performance.now();
  if (!force && App.playing && now - shareLastUpdate < 500) return;
  shareLastUpdate = now;
  computeShare();
  const P = curPlatform(), optimized = !!App.shareSettings;
  $('#shareColorRow').hidden = !P.ansi;
  $('#shareThemeAuto').textContent = P.theme ? `Auto (${P.name}: ${P.theme})` : 'Auto (keep editor colours)';
  $('#shareSplitRow').hidden = !P.limit;
  $('#shareTargetRow').hidden = !P.phoneCols;
  const checks = shareChecks(App.shareRes, App.shareSettings || S, optimized);
  const worst = checks.some(c => c.lvl === 'bad') ? 'bad' : checks.some(c => c.lvl === 'warn') ? 'warn' : 'ok';
  const v = $('#shareVerdict');
  v.className = 'verdict ' + worst;
  v.textContent = (worst === 'bad' ? `✖ This will NOT look right on ${P.name}` : worst === 'warn' ? `⚠ Works on ${P.name}, with caveats` : `✔ Ready to paste into ${P.name}`) + (optimized ? ' (fixed copy)' : '');
  // Fix all / fixed-copy state
  const fixable = checks.some(c => c.fixable && c.lvl !== 'ok');
  const canOpt = App.src && App.src.kind !== 'text';
  $('#fixAllBox').hidden = optimized || !fixable || !canOpt;
  $('#fixAllBtn').textContent = '✨ Fix all for ' + P.name;
  $('#optBox').hidden = !optimized;
  if (optimized) {
    $('#optTitle').textContent = 'Fixed copy for ' + P.name;
    const ul = $('#optChanges'); ul.innerHTML = '';
    const ch = App.shareChanges.length ? App.shareChanges : ['Nothing needed changing. Your current settings already suit ' + P.name + '.'];
    for (const c of ch) { const li = document.createElement('li'); li.textContent = c; ul.appendChild(li); }
    $('#optApply').hidden = !App.shareChanges.length;
  }
  const ul = $('#shareChecks'); ul.innerHTML = '';
  for (const c of checks) {
    const li = document.createElement('li'); li.className = c.lvl;
    li.innerHTML = `<i>${c.lvl === 'ok' ? '✔' : c.lvl === 'info' ? 'i' : c.lvl === 'warn' ? '!' : '✖'}</i><div></div>`;
    li.lastChild.textContent = c.msg;
    for (const f of [c.fix, c.fix2]) {
      if (!f || c.lvl === 'ok') continue;
      const b = document.createElement('button'); b.className = 'btn fix'; b.textContent = f.label; b.addEventListener('click', f.fn);
      li.lastChild.appendChild(document.createElement('br')); li.lastChild.appendChild(b);
    }
    ul.appendChild(li);
  }
  // copy buttons: one per message part
  const parts = App.shareParts || [], wrap = $('#shareCopyBtns');
  const sig = P.name + '|' + parts.length + '|' + worst;
  if (wrap.dataset.sig !== sig) {
    wrap.dataset.sig = sig; wrap.innerHTML = '';
    parts.forEach((_, i) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (worst === 'bad' ? '' : 'primary');
      b.textContent = parts.length === 1 ? 'Copy for ' + P.name : `Copy part ${i + 1} of ${parts.length}`;
      b.addEventListener('click', () => actCopyPart(i, b));
      wrap.appendChild(b);
    });
    $('#sharePartsNote').hidden = parts.length < 2;
  }
  App.shareWorst = worst;
}
function setShareOptimize(on) { S.shareOptimize = on; saveSettings(); updateShareUI(true); if (App.view === 'platform') updatePlatformView(); }
function applyFixToEditor() {
  const o = App.shareSettings; if (!o) return;
  const patch = {};
  for (const k of ['mode', 'cols', 'autoLevels', 'sharpen', 'outline', 'colorMode', 'cropL', 'cropR', 'cropT', 'cropB']) if (o[k] !== S[k]) patch[k] = o[k];
  patch.shareOptimize = false;
  applySettings(patch);
  toast('Fixes applied to your main settings');
}
async function actCopyPart(i, btn) {
  if (!requireRes()) return;
  updateShareUI(true);
  const P = curPlatform(), parts = App.shareParts || [];
  if (!parts[i]) return;
  if (App.shareWorst === 'bad' && !confirm(`This text will not display correctly on ${P.name} (see the red items in the Share panel).\n\nTip: press "Fix all" first.\n\nCopy anyway?`)) return;
  const n = parts.length;
  await copyOrShow(parts[i], n > 1 ? `Part ${i + 1} of ${n} copied. Paste and send it${i + 1 < n ? ', then copy part ' + (i + 2) : ''}` : `Copied ${App.shareSettings ? 'the fixed copy ' : ''}for ${P.name}${P.wrap === 'fence' ? ' (inside a code block)' : ''}. Paste it as one message`);
  if (btn && n > 1) btn.textContent = `✓ Part ${i + 1} of ${n} copied`;
}
async function actCopyForPlatform() { return actCopyPart(0); }

function stripWrap(t, P) {
  if (P.wrap === 'fence') return t.replace(/^```\w*\n/, '').replace(/\n```$/, '');
  if (P.wrap === 'indent') return t.split('\n').map(l => l.slice(4)).join('\n');
  return t;
}
function updatePlatformView() {
  const res = App.shareRes || App.res; if (!res) return;
  const P = curPlatform(), mono = P.wrap !== 'none', code = mono && P.wrap !== 'mono', colour = shareColour(P);
  const tc = targetCols(P), desk = S.shareTarget === 'desktop' || !P.phoneCols;
  $('#phone').classList.toggle('desk', desk);
  $('#phoneTitle').textContent = P.name;
  const chat = $('#phoneChat'); chat.innerHTML = '';
  const family = mono ? "ui-monospace,'Cascadia Mono',Consolas,'DejaVu Sans Mono',monospace" : "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif";
  const parts = (App.shareParts && App.shareParts.length ? App.shareParts : [platformText(res, P, colour)]).map(p => {
    let t = stripWrap(p, P);
    if (!mono) t = t.replace(/ {2,}/g, ' ');   // proportional-font apps collapse runs of normal spaces
    return t;
  });
  const plain = t => t.replace(/\u001b\[[0-9;]*m/g, '');
  const inner = Math.max(120, (chat.clientWidth ? chat.clientWidth - 24 : (desk ? 680 : 340)) - 20 - (code ? 12 : 0) - 4);
  let px = 13;
  if (tc) {
    const g = (updatePlatformView.ctx = updatePlatformView.ctx || document.createElement('canvas').getContext('2d'));
    g.font = `100px ${family}`;
    const lines = parts.flatMap(t => plain(t).split('\n'));
    if (res.cols <= tc) px = inner * 100 / Math.max(1, ...lines.map(l => g.measureText(l).width)) * 0.99;   // fits: widest real line just fits
    else { const longest = lines.reduce((a, l) => l.length > a.length ? l : a, ''); px = inner * 100 / Math.max(1, g.measureText(longest).width / Math.max(1, Array.from(longest).length) * tc); }   // too wide: show the wrapping
    px = clamp(px, 4, 28);
  }
  for (const t of parts) {
    const bubble = document.createElement('div'); bubble.className = 'bubble' + (code ? ' code' : '') + (colour || chatTheme(P) === 'dark' ? ' dark' : '');
    const pre = document.createElement('pre'); pre.style.font = `${px.toFixed(2)}px/1.25 ${family}`;
    if (colour) {   // render the Discord colours
      let col = DISCORD_CSS[37];
      for (const tok of t.split(/(\u001b\[[0-9;]*m)/)) {
        if (!tok) continue;
        const m = /^\u001b\[(?:\d+;)?(\d+)m$/.exec(tok);
        if (m) { col = DISCORD_CSS[m[1]] || col; continue; }
        const sp = document.createElement('span'); sp.style.color = col; sp.textContent = tok; pre.appendChild(sp);
      }
    } else pre.textContent = t;
    bubble.appendChild(pre); chat.appendChild(bubble);
  }
  $('#phoneNote').textContent = (desk ? 'Desktop' : 'Phone') + ' preview, ' + (mono ? 'monospace code block' : 'normal proportional font') + (parts.length > 1 ? `, ${parts.length} separate messages` : '') + (colour ? ', Discord colours (desktop only)' : '. Colours are not sent') + '. Real apps differ slightly by device.';
}
function saveText(kind) {
  if (!requireRes()) return;
  const res = App.res, name = baseName();
  if (kind === 'txt') download(new Blob([resultText(res)], { type: 'text/plain;charset=utf-8' }), name + '.txt');
  else if (kind === 'ans') download(new Blob([resultANSI(res)], { type: 'text/plain;charset=utf-8' }), name + '.ans');
  else if (kind === 'html') download(new Blob([resultHTMLDoc(res, S, name)], { type: 'text/html;charset=utf-8' }), name + '.html');
  else if (kind === 'svg') download(new Blob([resultSVG(res, S)], { type: 'image/svg+xml' }), name + '.svg');
}
async function renderStill(fmt) {
  const c = document.createElement('canvas');
  const solid = fmt.mime === 'image/jpeg' || fmt.ext === 'bmp';
  renderResult(App.res, S, c, safeScale(App.res, S.exportScale), { bgMode: solid && S.bgMode === 'transparent' ? 'solid' : undefined });
  if (fmt.ext === 'bmp') return encodeBMP(c.getContext('2d').getImageData(0, 0, c.width, c.height));
  return canvasToBlob(c, fmt.mime, S.quality);
}
async function saveImage(fmt) {
  if (!requireRes()) return;
  try { download(await renderStill(fmt), baseName() + '.' + fmt.ext); } catch (e) { toast(e.message, 'error'); }
}
async function actCopyImage() {
  if (!requireRes()) return;
  try {
    const blob = await renderStill(IMG_FORMATS[0]);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Image copied to clipboard');
  } catch (e) { toast('Copying images is not allowed here. Use PNG download instead', 'error'); }
}

/* ---- batch: many files with the current look, one ZIP ---- */
async function loadFileSource(file) {
  const name = file.name || 'file', ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  const fmt = sniffFormat(new Uint8Array(await file.slice(0, 64).arrayBuffer())), type = SNIFF_MIME[fmt] || file.type || MIME_BY_EXT[ext] || '';
  let src;
  if (!fmt && (type.startsWith('text/') || ['txt', 'ans', 'nfo', 'asc'].includes(ext))) { const { text, ansi } = await readTextArt(file), r = textResultRaw(text, S, ansi); src = { kind: 'text', text, ansi, w: r.cols, h: r.rows }; }
  else if (fmt === 'video' || (!fmt && (type.startsWith('video/') || VIDEO_EXT.has(ext)))) { src = await loadVideoFile(file); src.video.muted = true; }
  else src = await loadImageFile(file, fmt, ext);
  src.name = name;
  return src;
}
function releaseSource(s) {   // like disposeSource, for a source that was never opened
  s.disposed = true;
  try { if (s.bmp && s.bmp.close) s.bmp.close(); } catch (e) {}
  if (s.frames) for (const f of s.frames) { try { f.bmp.close && f.bmp.close(); } catch (e) {} }
  if (s.video) { try { s.video.pause(); } catch (e) {} s.video.removeAttribute('src'); s.video.remove(); }
  if (s.url) URL.revokeObjectURL(s.url);
}
async function runBatch(files, opts) {
  if (App.exporting) return toast('An export is already running');
  setPlaying(false);
  App.exporting = true; App.cancel = false;
  showProgress(`Converting ${files.length} files`);
  const out = [], enc = new TextEncoder(), c = document.createElement('canvas'), used = new Set();
  const bytes = async b => new Uint8Array(await b.arrayBuffer());
  try {
    for (let i = 0; i < files.length; i++) {
      if (App.cancel) throw cancelled();
      const file = files[i], step = p => setProgress((i + p) / files.length, `${i + 1} / ${files.length}: ${file.name}`);
      let base = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'file';
      step(0);
      let src = null;
      try {
        src = await loadFileSource(file);
        base += '_' + (src.kind === 'text' ? 'text' : S.mode);
        while (used.has(base)) base += '_'; used.add(base);
        const moving = src.kind === 'anim' || src.kind === 'video';
        if (moving && opts.gif) out.push({ name: base + '.gif', data: await gifBytes(p => step(clamp(p, 0, 1) * 0.9), src) });
        let res;
        if (src.kind === 'text') res = textResult(src.text, S, src.ansi);
        else if (src.kind === 'video') { await seekVideo(src.video, 0); res = convert(src.video, src.video.videoWidth, src.video.videoHeight, S); }
        else res = convert(src.kind === 'anim' ? src.frames[0].bmp : src.bmp, src.w, src.h, S);
        const still = moving ? '_frame1' : '';
        for (const f of IMG_FORMATS) if (opts[f.ext]) {
          const solid = f.mime === 'image/jpeg' || f.ext === 'bmp';
          renderResult(res, S, c, safeScaleQuiet(res, S.exportScale), { bgMode: solid && S.bgMode === 'transparent' ? 'solid' : undefined });
          out.push({ name: base + still + '.' + f.ext, data: f.ext === 'bmp' ? await bytes(encodeBMP(c.getContext('2d').getImageData(0, 0, c.width, c.height))) : await bytes(await canvasToBlob(c, f.mime, S.quality)) });
        }
        if (opts.txt) out.push({ name: base + still + '.txt', data: enc.encode(resultText(res)) });
        if (opts.html) out.push({ name: base + still + '.html', data: enc.encode(resultHTMLDoc(res, S, base)) });
      } catch (e) {
        if (e && e.cancelled) throw e;
        while (used.has(base)) base += '_'; used.add(base);
        out.push({ name: base + '_FAILED.txt', data: enc.encode(`Could not convert ${file.name}: ${e && e.message || e}\n`) });
      } finally { if (src) releaseSource(src); }
      await nextTick();
    }
    setProgress(1, 'Compressing the ZIP…');
    const zip = await makeZipAsync(out);
    download(zip, `text-art-batch_${files.length}-files.zip`);
    const failed = out.filter(f => f.name.endsWith('_FAILED.txt')).length;
    toast(`Batch ZIP saved (${fmtBytes(zip.size)})${failed ? `, ${failed} file${failed > 1 ? 's' : ''} could not be converted (see the ZIP)` : ''}`, failed ? 'error' : undefined);
  } catch (e) {
    if (e && e.cancelled) toast('Batch cancelled'); else { console.error(e); toast('Batch failed: ' + (e && e.message || e), 'error'); }
  } finally {
    hideProgress(); App.exporting = false; clearEngineCaches(); App.dirty = true;
  }
}
function openBatchDialog() {
  const d = $('#batchDialog'), box = $('#batchFormats');
  if (!box.childElementCount) for (const f of IMG_FORMATS) box.insertAdjacentHTML('beforeend', `<label class="chk"><input type="checkbox" data-bf="${f.ext}"${f.ext === 'png' ? ' checked' : ''}> ${f.label}</label>`);
  $('#batchFiles').value = ''; $('#batchCount').textContent = 'No files chosen'; $('#batchGo').disabled = true;
  d.showModal();
}
/* progress modal */
function showProgress(title, indeterminate) {
  $('#progTitle').textContent = title; $('#progText').textContent = '';
  $('#progBarWrap').classList.toggle('indet', !!indeterminate); $('#progBar').style.width = '0%';
  $('#progCancel').hidden = !!indeterminate;
  $('#progress').hidden = false;
}
function setProgress(p, text) { const v = (clamp(p, 0, 1) * 100).toFixed(1); $('#progBar').style.width = v + '%'; $('#progBarWrap').setAttribute('aria-valuenow', String(Math.round(+v))); if (text != null) $('#progText').textContent = text; }
function hideProgress() { $('#progress').hidden = true; }
const cancelled = () => { const e = new Error('cancelled'); e.cancelled = true; return e; };

async function runExport(title, fn) {
  if (App.exporting) { toast('An export is already running'); return; }
  if (!App.src) return;
  setPlaying(false);
  App.exporting = true; App.cancel = false;
  const saved = { time: App.time, vt: App.src.video ? App.src.video.currentTime : 0 };
  showProgress(title);
  try { await fn(setProgress); }
  catch (e) { if (e && e.cancelled) toast('Export cancelled'); else { console.error(e); toast('Export failed: ' + (e && e.message || e), 'error'); } }
  finally {
    hideProgress(); App.exporting = false;
    if (App.src && App.src.kind === 'video') { try { App.src.video.currentTime = saved.vt; } catch (e) {} }
    App.time = saved.time; App.dirty = true; App.lastIdx = -1;
  }
}
function seekVideo(v, t) {
  return new Promise(res => {
    t = clamp(t, 0, Math.max(0, (v.duration || 0) - 0.001));
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return res();
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); clearTimeout(to); res(); };
    const to = setTimeout(fin, 4000);
    v.addEventListener('seeked', fin); v.currentTime = t;
  });
}
/* Iterates the frames to export (respects trim range, frame step, fps). */
/* the frames to export of a source (the open one by default: then the trim range applies) */
const rangeOf = s => s === App.src ? trimRange() : [0, s.kind === 'anim' ? s.duration : s.kind === 'video' && isFinite(s.video.duration) ? s.video.duration : 0];
async function* exportFrames(s = App.src, fps0 = S.gifFps) {
  if (s.kind === 'anim' && s.complete === false) await s.ready;   // still decoding: wait for every frame
  if (s.kind === 'anim') {
    const [a, b] = rangeOf(s), i0 = frameIndexIn(s, a), i1 = frameIndexIn(s, Math.max(a, b - 1e-6));
    const step = Math.max(1, Math.round(S.frameStep)), total = Math.floor((i1 - i0) / step) + 1;
    let k = 0;
    for (let i = i0; i <= i1; i += step, k++) {
      let d = 0; for (let j = i; j < Math.min(i + step, i1 + 1); j++) d += s.frames[j].delay;
      yield { d: s.frames[i].bmp, w: s.w, h: s.h, delay: d, index: k, total, t: s.frames[i].t0 };
    }
  } else if (s.kind === 'video') {
    const v = s.video, fps = clamp(fps0, 1, 60), [a, b] = rangeOf(s);
    const total = Math.max(1, Math.floor((b - a) * fps + 1e-6));
    for (let k = 0; k < total; k++) {
      await seekVideo(v, a + k / fps);
      yield { d: v, w: v.videoWidth, h: v.videoHeight, delay: 1000 / fps, index: k, total, t: a + k / fps };
    }
  } else {
    const d = s.kind === 'text' ? null : s === App.src ? currentDrawable() : [s.bmp, s.w, s.h];
    yield { d: d && d[0], w: d && d[1], h: d && d[2], text: s.kind === 'text' ? s.text : null, ansi: s.ansi || null, delay: 100, index: 0, total: 1 };
  }
}
const frameResult = f => f.text != null ? textResult(f.text, S, f.ansi) : convert(f.d, f.w, f.h, frameSettings(f));
function confirmLarge(total) {
  if (total > 900) return confirm(`This will export ${total} frames, which can take a while and use a lot of memory. Continue? (Tip: set a trim range or lower the FPS.)`);
  return true;
}
function countFrames() {
  const s = App.src, [a, b] = trimRange();
  if (s.kind === 'anim') return Math.floor((frameIndexAt(Math.max(a, b - 1e-6)) - frameIndexAt(a)) / Math.max(1, S.frameStep)) + 1;
  if (s.kind === 'video') return Math.max(1, Math.floor((b - a) * S.gifFps));
  return 1;
}

/* A GIF frame job. With diff, only the rectangle that changed since the previous frame is stored, and pixels in it that
   did not change are transparent (they keep showing the previous frame); an unchanged frame is 1 transparent pixel. */
function gifFrameJob(rgba, prev, W, H, o) {
  const base = { colors: o.colors, delay: o.delay, disposal: o.transparent ? 2 : 1, opt: { dither: o.dither, global: o.global, x: 0, y: 0 } };
  if (!o.diff || !prev) return Object.assign(base, { rgba, transparent: o.transparent, w: W, h: H });
  const a32 = new Uint32Array(rgba.buffer, rgba.byteOffset, W * H), b32 = new Uint32Array(prev.buffer, prev.byteOffset, W * H);
  let x0 = W, y0 = -1, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const r = y * W; let first = -1, last = -1;
    for (let x = 0; x < W; x++) if (a32[r + x] !== b32[r + x]) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    if (y0 < 0) y0 = y; y1 = y; if (first < x0) x0 = first; if (last > x1) x1 = last;
  }
  if (y0 < 0) return Object.assign(base, { rgba: new Uint8ClampedArray(4), transparent: true, w: 1, h: 1 });
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4), alt = new Uint8ClampedArray(w * h * 4);
  const o32 = new Uint32Array(out.buffer), t32 = new Uint32Array(alt.buffer);
  for (let y = 0; y < h; y++) { const r = (y0 + y) * W + x0, q = y * w; for (let x = 0; x < w; x++) { const v = a32[r + x]; o32[q + x] = v === b32[r + x] ? 0 : v; t32[q + x] = v; } }
  base.opt.x = x0; base.opt.y = y0;
  // alt: the same rectangle without transparent holes, which compresses better when most of it changed
  return Object.assign(base, { rgba: out, alt, transparent: true, w, h });
}
/* bytes of a GIF frame job: the smaller of the two ways to store a changed rectangle */
function gifJobBytes(a) {
  const b1 = gifFrameBytes(a.rgba, a.colors, a.transparent, a.delay, a.disposal, a.w, a.h, a.opt);
  if (!a.alt) return b1;
  const b2 = gifFrameBytes(a.alt, a.colors, false, a.delay, a.disposal, a.w, a.h, a.opt);
  return b2.length < b1.length ? b2 : b1;
}
/* One palette for the whole animation, from up to 16 frames spread over the trim range. */
async function gifSharedPalette(scale, colors, withTransparency, s = App.src) {
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  const [a, b] = rangeOf(s); let H = null;
  const add = res => { renderResult(res, S, c, scale); H = rgbaHistogram(g.getImageData(0, 0, c.width, c.height).data, S.bgMode === 'transparent', H); };
  if (s.kind === 'anim') {
    const i0 = frameIndexIn(s, a), i1 = frameIndexIn(s, Math.max(a, b - 1e-6)), n = Math.min(16, i1 - i0 + 1);
    for (let k = 0; k < n; k++) { const f = s.frames[Math.round(i0 + (i1 - i0) * (n > 1 ? k / (n - 1) : 0))]; add(convert(f.bmp, s.w, s.h, s === App.src ? settingsAt(f.t0) : S)); await nextTick(); }
  } else if (s.kind === 'video') {
    const v = s.video;
    for (let k = 0; k < 12; k++) { const t = a + (b - a) * k / 12; await seekVideo(v, t); add(convert(v, v.videoWidth, v.videoHeight, s === App.src ? settingsAt(t) : S)); }
  } else if (s.kind === 'text') add(textResult(s.text, S, s.ansi));
  else { const d = s === App.src ? currentDrawable() : [s.bmp, s.w, s.h]; if (d) add(convert(d[0], d[1], d[2], S)); }
  const P = paletteFromHistogram(H.cnt, H.sr, H.sg, H.sb, colors, withTransparency);
  P.near = nearestLut(P.pal, P.off, P.n);
  return P;
}
/* Draws every export frame (on workers, several at once) and hands the pixels to onFrame(rgba, delayMs, W, H)
   in frame order. onFirst(W, H, scale) runs once, before the first frame is drawn. */
/* o: { fps (video sources), ropts (renderResult options, e.g. even size / solid background), throttle (awaited before each frame) } */
async function forEachRenderedFrame(progress, onFirst, onFrame, src = App.src, o = {}) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  const renders = new OrderedJobs(), ready = [], delays = [];
  let scale = 1, W = 0, H = 0, next = 0, started = false;
  const flush = () => { for (; ready[next] !== undefined; next++) { const px = ready[next]; ready[next] = undefined; onFrame(px, delays[next], W, H); } };
  for await (const f of exportFrames(src, o.fps)) {
    if (App.cancel) throw cancelled();
    if (o.throttle) await o.throttle();
    const St = src === App.src ? frameSettings(f) : S;
    const a = Pool.size() ? frameJobArgs(f, St) : { res: frameResult(f) };
    if (!started) {   // every frame has the size of the first
      started = true;
      const g = a.res || gridFor(f.w, f.h, S); scale = safeScale(g, S.exportScale);
      [W, H] = pictureSize(g.cols, g.rows, S, scale);
      if (o.ropts && o.ropts.even) { W += W & 1; H += H & 1; }
      await onFirst(W, H, scale);
    }
    const k = delays.length; delays.push(f.delay);
    Object.assign(a, { St, scale, w: W, h: H, ropts: o.ropts });
    const local = () => { renderResult(frameJobResult(a, St), S, canvas, scale, o.ropts); return ctx.getImageData(0, 0, W, H).data; };
    await renders.add(() => Pool.run('renderFrame', a), local);
    renders.list[k].then(px => { ready[k] = px; flush(); });
    progress(renders.done / f.total * 0.9, `Frame ${f.index + 1} / ${f.total}`);
    await nextTick();
  }
  await renders.all(); flush();
}
async function exportGIF() {
  if (!confirmLarge(countFrames())) return;
  await runExport('Encoding GIF', async progress => {
    const bytes = await gifBytes(progress);
    download(new Blob([bytes], { type: 'image/gif' }), baseName() + '.gif');
    toast(`GIF saved (${fmtBytes(bytes.length)})`);
  });
}
/* the GIF file of a source's frames (the open source: its trim range) */
async function gifBytes(progress, src = App.src) {
  const transparent = S.bgMode === 'transparent', diff = !!S.gifDiff && !transparent, dither = !!S.gifDither, colors = S.gifColors;
  let enc = null, global = null, accMs = 0, emittedCs = 0, prev = null;
  const encodes = new OrderedJobs();   // quantise + LZW on workers, in parallel
  await forEachRenderedFrame(progress, async (W, H, scale) => {
    if (S.gifPalette === 'global') { progress(0, 'Choosing the colours…'); global = await gifSharedPalette(scale, colors, transparent || diff, src); }
    enc = new GifEncoder(W, H, 0, global);
  }, (rgba, delay, W, H) => {
    accMs += delay; let cs = Math.round(accMs / 10) - emittedCs; cs = Math.max(2, cs); emittedCs += cs;
    const a = gifFrameJob(rgba, prev, W, H, { colors, transparent, diff, dither, global, delay: cs });
    prev = rgba;
    encodes.add(() => Pool.run('gif', a), () => gifJobBytes(a));
  }, src);
  for (const b of await encodes.all(n => progress(0.9 + 0.1 * n / encodes.count, `Encoding ${n} / ${encodes.count}`))) enc.addFrameBytes(b);
  return enc.finish();
}
/* The rectangle that changed since the previous frame: { x, y, w, h, holes (unchanged pixels transparent), solid }, or
   null when nothing changed. even: x and y on even pixels (WebP stores offsets / 2). */
function changedRect(rgba, prev, W, H, even) {
  const a32 = new Uint32Array(rgba.buffer, rgba.byteOffset, W * H), b32 = new Uint32Array(prev.buffer, prev.byteOffset, W * H);
  let x0 = W, y0 = -1, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const r = y * W; let first = -1, last = -1;
    for (let x = 0; x < W; x++) if (a32[r + x] !== b32[r + x]) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    if (y0 < 0) y0 = y; y1 = y; if (first < x0) x0 = first; if (last > x1) x1 = last;
  }
  if (y0 < 0) return null;
  if (even) { x0 &= ~1; y0 &= ~1; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, holes = new Uint8ClampedArray(w * h * 4), solid = new Uint8ClampedArray(w * h * 4);
  const o32 = new Uint32Array(holes.buffer), s32 = new Uint32Array(solid.buffer);
  for (let y = 0; y < h; y++) { const r = (y0 + y) * W + x0, q = y * w; for (let x = 0; x < w; x++) { const v = a32[r + x]; s32[q + x] = v; o32[q + x] = v === b32[r + x] ? 0 : v; } }
  return { x: x0, y: y0, w, h, holes, solid };
}
/* ---- APNG (lossless, full colour, alpha) ---- */
async function zlibDeflate(u8) {
  const cs = new CompressionStream('deflate'), wr = cs.writable.getWriter();
  wr.write(u8); wr.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
/* PNG scanlines with the usual adaptive filter choice (per row the filter with the smallest sum of |values|). */
function pngFiltered(rgba, w, h) {
  const stride = w * 4, out = new Uint8Array((stride + 1) * h), row = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const c = y * stride, p = c - stride, o = y * (stride + 1);
    let bestT = 0, best = Infinity;
    for (let t = 0; t < 5; t++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = rgba[c + i], a = i >= 4 ? rgba[c + i - 4] : 0, b = y ? rgba[p + i] : 0, cc = i >= 4 && y ? rgba[p + i - 4] : 0;
        let v;
        if (t === 0) v = x; else if (t === 1) v = x - a; else if (t === 2) v = x - b; else if (t === 3) v = x - ((a + b) >> 1);
        else { const pa = Math.abs(b - cc), pb = Math.abs(a - cc), pc = Math.abs(a + b - 2 * cc); v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc); }
        v &= 255; sum += v < 128 ? v : 256 - v;
        if (sum >= best) break;
      }
      if (sum < best) { best = sum; bestT = t; }
    }
    out[o] = bestT;
    for (let i = 0; i < stride; i++) {
      const x = rgba[c + i], a = i >= 4 ? rgba[c + i - 4] : 0, b = y ? rgba[p + i] : 0, cc = i >= 4 && y ? rgba[p + i - 4] : 0;
      let v;
      if (bestT === 0) v = x; else if (bestT === 1) v = x - a; else if (bestT === 2) v = x - b; else if (bestT === 3) v = x - ((a + b) >> 1);
      else { const pa = Math.abs(b - cc), pb = Math.abs(a - cc), pc = Math.abs(a + b - 2 * cc); v = x - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc); }
      out[o + 1 + i] = v;
    }
  }
  return out;
}
/* a frame job → { data (zlib), blend }: the smaller of "changed pixels over the previous frame" and "the whole rectangle" */
async function apngJobBytes(a) {
  const enc = px => zlibDeflate(pngFiltered(px, a.w, a.h));
  if (!a.holes) return { data: await enc(a.rgba), blend: 0 };
  const [d1, d2] = await Promise.all([enc(a.holes), enc(a.rgba)]);
  return d1.length < d2.length ? { data: d1, blend: 1 } : { data: d2, blend: 0 };
}
function apngFile(W, H, frames) {
  const u32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255], u16 = v => [(v >> 8) & 255, v & 255];
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', new Uint8Array([...u32(W), ...u32(H), 8, 6, 0, 0, 0])), pngChunk('acTL', new Uint8Array([...u32(frames.length), ...u32(0)]))];
  let seq = 0;
  frames.forEach((f, i) => {
    parts.push(pngChunk('fcTL', new Uint8Array([...u32(seq++), ...u32(f.w), ...u32(f.h), ...u32(f.x), ...u32(f.y), ...u16(Math.min(65535, Math.max(1, Math.round(f.delay)))), ...u16(1000), 0, f.blend])));
    if (i === 0) parts.push(pngChunk('IDAT', f.data));
    else { const d = new Uint8Array(4 + f.data.length); d.set(u32(seq++)); d.set(f.data, 4); parts.push(pngChunk('fdAT', d)); }
  });
  parts.push(pngChunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}
/* ---- animated WebP (smallest; lossy at the JPG/WEBP quality) ---- */
async function webpStill(px, w, h, quality) {
  const c = new OffscreenCanvas(w, h); c.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
  const b = await c.convertToBlob({ type: 'image/webp', quality });
  if (b.type !== 'image/webp') throw new Error('WEBP encoding is not supported');
  const d = new Uint8Array(await b.arrayBuffer()), out = { alph: null, bits: null, id: '' };
  for (let q = 12; q + 8 <= d.length;) {
    const id = String.fromCharCode(d[q], d[q + 1], d[q + 2], d[q + 3]), n = u32le(d, q + 4);
    if (id === 'ALPH') out.alph = d.slice(q + 8, q + 8 + n); else if (id === 'VP8 ' || id === 'VP8L') { out.bits = d.slice(q + 8, q + 8 + n); out.id = id; }
    q += 8 + n + (n & 1);
  }
  if (!out.bits) throw new Error('unexpected WEBP data');
  return out;
}
const webpSize = f => (f.alph ? 8 + f.alph.length + (f.alph.length & 1) : 0) + 8 + f.bits.length + (f.bits.length & 1);
async function webpJobBytes(a) {
  if (!a.holes) return Object.assign(await webpStill(a.rgba, a.w, a.h, a.quality), { blend: 0 });
  const [f1, f2] = await Promise.all([webpStill(a.holes, a.w, a.h, a.quality), webpStill(a.rgba, a.w, a.h, a.quality)]);
  return webpSize(f1) < webpSize(f2) ? Object.assign(f1, { blend: 1 }) : Object.assign(f2, { blend: 0 });
}
function webpFile(W, H, frames, alpha) {
  const le = (v, n) => { const o = []; for (let i = 0; i < n; i++) o.push((v >>> (8 * i)) & 255); return o; };
  const chunk = (id, data) => { const pad = data.length & 1, out = new Uint8Array(8 + data.length + pad); for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i); out.set(le(data.length, 4), 4); out.set(data, 8); return out; };
  const body = [chunk('VP8X', new Uint8Array([(alpha ? 0x10 : 0) | 0x02, 0, 0, 0, ...le(W - 1, 3), ...le(H - 1, 3)])), chunk('ANIM', new Uint8Array([0, 0, 0, 0, 0, 0]))];
  for (const f of frames) {
    const inner = [];
    if (f.alph) inner.push(chunk('ALPH', f.alph));
    inner.push(chunk(f.id, f.bits));
    const head = new Uint8Array([...le(f.x >> 1, 3), ...le(f.y >> 1, 3), ...le(f.w - 1, 3), ...le(f.h - 1, 3), ...le(Math.min(0xFFFFFF, Math.max(1, Math.round(f.delay))), 3), f.blend ? 0 : 0x02]);
    const len = head.length + inner.reduce((n, c) => n + c.length, 0), anmf = new Uint8Array(8 + len + (len & 1));
    anmf.set([65, 78, 77, 70], 0); anmf.set(le(len, 4), 4); let o = 8; anmf.set(head, o); o += head.length; for (const c of inner) { anmf.set(c, o); o += c.length; }
    body.push(anmf);
  }
  const size = 4 + body.reduce((n, c) => n + c.length, 0), head = new Uint8Array(12);
  head.set([82, 73, 70, 70], 0); head.set(le(size, 4), 4); head.set([87, 69, 66, 80], 8);
  return new Blob([head, ...body], { type: 'image/webp' });
}
const ANIM_CODECS = {
  apng: { label: 'APNG', ext: 'png', op: 'apng', job: apngJobBytes, even: false },
  webp: { label: 'animated WEBP', ext: 'webp', op: 'webp', job: webpJobBytes, even: true },
};
/* APNG / animated WEBP: full colour; with "store only what changes" a frame keeps only its changed rectangle,
   and a frame that did not change just lengthens the previous one. */
async function exportAnimated(kind) {
  const C = ANIM_CODECS[kind];
  if (!confirmLarge(countFrames())) return;
  await runExport('Encoding ' + C.label, async progress => {
    const diff = !!S.gifDiff, holesOk = S.bgMode !== 'transparent', quality = S.quality, encodes = new OrderedJobs(), meta = [];
    let prev = null, W0 = 0, H0 = 0;
    await forEachRenderedFrame(progress, (W, H) => { W0 = W; H0 = H; }, (rgba, delay, W, H) => {
      if (diff && prev) {
        const r = changedRect(rgba, prev, W, H, C.even);
        prev = rgba;
        if (!r) { if (meta.length) meta[meta.length - 1].delay += delay; return; }
        const a = { rgba: r.solid, holes: holesOk ? r.holes : null, w: r.w, h: r.h, quality };
        meta.push({ x: r.x, y: r.y, w: r.w, h: r.h, delay });
        encodes.add(() => Pool.run(C.op, a), () => C.job(a));
        return;
      }
      prev = rgba;
      const a = { rgba, holes: null, w: W, h: H, quality };
      meta.push({ x: 0, y: 0, w: W, h: H, delay });
      encodes.add(() => Pool.run(C.op, a), () => C.job(a));
    });
    const enc = await encodes.all(n => progress(0.9 + 0.1 * n / encodes.count, `Encoding ${n} / ${encodes.count}`));
    const frames = enc.map((e, i) => Object.assign({}, meta[i], e));
    const blob = kind === 'apng' ? apngFile(W0, H0, frames) : webpFile(W0, H0, frames, S.bgMode === 'transparent' || frames.some(f => f.alph || f.id === 'VP8L'));
    download(blob, baseName() + (kind === 'apng' ? '_anim.png' : '.webp'));
    toast(`${C.label} saved (${fmtBytes(blob.size)})`);
  });
}
const ANIM_WEBP_OK = (() => { try { return typeof OffscreenCanvas !== 'undefined' && typeof CompressionStream !== 'undefined' && document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch (e) { return false; } })();
const APNG_OK = typeof CompressionStream !== 'undefined';
function audioTracksFor(s) {
  try {
    if (!s.audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC(), node = ctx.createMediaElementSource(s.video), dest = ctx.createMediaStreamDestination();
      node.connect(dest); node.connect(ctx.destination);
      s.audio = { ctx, dest };
    }
    s.audio.ctx.resume();
    return s.audio.dest.stream.getAudioTracks();
  } catch (e) { console.warn('audio capture unavailable', e); return []; }
}
/* ---- video files encoded with WebCodecs: as fast as the computer allows, exact frame times ---- */
/* WebM (Matroska): EBML header, Info, Tracks, Clusters of SimpleBlocks, Cues. chunks: { data, t (ms), key } */
function webmFile(W, H, codecId, chunks, durationMs) {
  const vint = n => { let len = 1; while (n >= 2 ** (7 * len) - 1 && len < 8) len++; const b = []; for (let i = len - 1; i >= 0; i--) b.push(Math.floor(n / 2 ** (8 * i)) & 255); b[0] |= 1 << (8 - len); return b; };
  const uint = n => { const b = []; do { b.unshift(n & 255); n = Math.floor(n / 256); } while (n > 0); return b; };
  const idb = id => { const b = []; while (id > 0) { b.unshift(id & 255); id = Math.floor(id / 256); } return b; };
  const el = (id, parts) => { const body = new Blob(parts); return { size: idb(id).length + vint(body.size).length + body.size, blob: new Blob([new Uint8Array([...idb(id), ...vint(body.size)]), body]) }; };
  const u = (id, n) => el(id, [new Uint8Array(uint(n))]), str = (id, t) => el(id, [new TextEncoder().encode(t)]);
  const f64 = (id, x) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); return el(id, [b]); };
  const head = el(0x1A45DFA3, [u(0x4286, 1).blob, u(0x42F7, 1).blob, u(0x42F2, 4).blob, u(0x42F3, 8).blob, str(0x4282, 'webm').blob, u(0x4287, 4).blob, u(0x4285, 2).blob]);
  const info = el(0x1549A966, [u(0x2AD7B1, 1000000).blob, str(0x4D80, 'Text Art Studio').blob, str(0x5741, 'Text Art Studio').blob, f64(0x4489, durationMs).blob]);
  const tracks = el(0x1654AE6B, [el(0xAE, [u(0xD7, 1).blob, u(0x73C5, 1).blob, u(0x83, 1).blob, u(0x9C, 0).blob, str(0x86, codecId).blob, el(0xE0, [u(0xB0, W).blob, u(0xBA, H).blob]).blob]).blob]);
  // SeekHead (where Info, Tracks and Cues are); its positions are written with 8 bytes, so its size is known in advance
  const u8 = (id, n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n)); return el(id, [b]); };
  const seekHead = at => el(0x114D9B74, at.map(([id, n]) => el(0x4DBB, [el(0x53AB, [new Uint8Array(idb(id))]).blob, u8(0x53AC, n).blob]).blob));
  const shSize = seekHead([[0x1549A966, 0], [0x1654AE6B, 0], [0x1C53BB6B, 0]]).size;
  const parts = [null, info, tracks], cues = [];
  let pos = shSize + info.size + tracks.size, i = 0;
  while (i < chunks.length) {   // a cluster starts at a key frame and covers at most 30 s (block times are 16-bit)
    const t0 = Math.round(chunks[i].t), blocks = [u(0xE7, t0).blob];
    cues.push([t0, pos]);
    do {
      const c = chunks[i], rel = Math.round(c.t) - t0, hdr = new Uint8Array([0x81, (rel >> 8) & 255, rel & 255, c.key ? 0x80 : 0]);
      blocks.push(el(0xA3, [hdr, c.data]).blob); i++;
    } while (i < chunks.length && !(chunks[i].key && Math.round(chunks[i].t) - t0 > 0) && Math.round(chunks[i].t) - t0 < 30000);
    const cl = el(0x1F43B675, blocks); parts.push(cl); pos += cl.size;
  }
  parts.push(el(0x1C53BB6B, cues.map(([t, at]) => el(0xBB, [u(0xB3, t).blob, el(0xB7, [u(0xF7, 1).blob, u(0xF1, at).blob]).blob]).blob)));
  parts[0] = seekHead([[0x1549A966, shSize], [0x1654AE6B, shSize + info.size], [0x1C53BB6B, pos]]);
  return new Blob([head.blob, el(0x18538067, parts.map(x => x.blob)).blob], { type: 'video/webm' });
}
/* MP4 (H.264, "fast start": moov before mdat). chunks: { data, t (ms), key }; avcC: the encoder's decoder description */
function mp4File(W, H, avcC, chunks, durationMs) {
  const TS = 90000, be = (n, len) => { const b = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { b[i] = n & 255; n = Math.floor(n / 256); } return b; };
  const box = (type, ...parts) => { const body = new Blob(parts); return new Blob([be(8 + body.size, 4), new TextEncoder().encode(type), body]); };
  const full = (type, ver, flags, ...parts) => box(type, new Uint8Array([ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
  const ticks = chunks.map(c => Math.round(c.t * TS / 1000)), end = Math.round(durationMs * TS / 1000), dur = chunks.map((c, i) => Math.max(1, (i + 1 < chunks.length ? ticks[i + 1] : end) - ticks[i]));
  const stts = []; for (const d of dur) { const last = stts[stts.length - 1]; if (last && last[1] === d) last[0]++; else stts.push([1, d]); }
  const matrix = new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0]);
  const durMs = Math.round(durationMs), mdatSize = chunks.reduce((n, c) => n + c.data.length, 0);
  const moov = off => box('moov',
    full('mvhd', 0, 0, be(0, 4), be(0, 4), be(1000, 4), be(durMs, 4), be(0x00010000, 4), be(0x0100, 2), new Uint8Array(10), matrix, new Uint8Array(24), be(2, 4)),
    box('trak',
      full('tkhd', 0, 3, be(0, 4), be(0, 4), be(1, 4), be(0, 4), be(durMs, 4), new Uint8Array(8), be(0, 2), be(0, 2), be(0, 2), be(0, 2), matrix, be(W * 65536, 4), be(H * 65536, 4)),
      box('mdia',
        full('mdhd', 0, 0, be(0, 4), be(0, 4), be(TS, 4), be(end, 4), be(0x55C4, 2), be(0, 2)),
        full('hdlr', 0, 0, be(0, 4), new TextEncoder().encode('vide'), new Uint8Array(12), new TextEncoder().encode('VideoHandler\0')),
        box('minf',
          full('vmhd', 0, 1, new Uint8Array(8)),
          box('dinf', full('dref', 0, 0, be(1, 4), full('url ', 0, 1))),
          box('stbl',
            full('stsd', 0, 0, be(1, 4), box('avc1', new Uint8Array(6), be(1, 2), new Uint8Array(16), be(W, 2), be(H, 2), be(0x00480000, 4), be(0x00480000, 4), be(0, 4), be(1, 2), new Uint8Array(32), be(0x18, 2), be(0xFFFF, 2), box('avcC', avcC))),
            full('stts', 0, 0, be(stts.length, 4), ...stts.flatMap(([n, d]) => [be(n, 4), be(d, 4)])),
            full('stss', 0, 0, be(chunks.filter(c => c.key).length, 4), ...chunks.map((c, i) => c.key ? be(i + 1, 4) : null).filter(Boolean)),
            full('stsc', 0, 0, be(1, 4), be(1, 4), be(chunks.length, 4), be(1, 4)),
            full('stsz', 0, 0, be(0, 4), be(chunks.length, 4), ...chunks.map(c => be(c.data.length, 4))),
            full('stco', 0, 0, be(1, 4), be(off, 4)))))));
  const ftyp = box('ftyp', new TextEncoder().encode('isom'), be(512, 4), new TextEncoder().encode('isomiso2avc1mp41'));
  const m0 = moov(0), off = ftyp.size + m0.size + 8;   // the offset does not change the size of moov
  return new Blob([ftyp, moov(off), be(8 + mdatSize, 4), new TextEncoder().encode('mdat'), ...chunks.map(c => c.data)], { type: 'video/mp4' });
}
const FAST_VIDEO_OK = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
async function pickVideoCodec(ext, W, H, bitrate, fps) {
  const list = ext === 'mp4' ? ['avc1.640033', 'avc1.4d0033', 'avc1.42003e', 'avc1.42001f'] : ['vp09.00.10.08', 'vp8'];
  for (const codec of list) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps };
    if (ext === 'mp4') cfg.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) {}
  }
  return null;
}
/* MP4 / WEBM without real-time recording: frames are drawn (on workers) and encoded as fast as possible */
async function exportVideoFast(ext) {
  const s = App.src, label = ext === 'mp4' ? 'MP4' : 'WEBM';
  await runExport(`Encoding ${label}`, async progress => {
    const fps = clamp(S.videoFps, 1, 60), bitrate = Math.round(S.videoBitrate * 1e6), chunks = [];
    let enc = null, cfg = null, avcC = null, err = null, t = 0, lastKey = -1e9, queued = 0;
    const throttle = async () => { while (!err && (queued > 6 || (enc && enc.encodeQueueSize > 6))) await new Promise(r => setTimeout(r, 4)); if (err) throw err; };
    await forEachRenderedFrame(progress, async (W, H) => {
      cfg = await pickVideoCodec(ext, W, H, bitrate, fps);
      if (!cfg) throw new Error(`this browser cannot encode ${label} at ${W}×${H}`);
      enc = new VideoEncoder({ output: (chunk, meta) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); chunks.push({ data, t: chunk.timestamp / 1000, key: chunk.type === 'key' }); if (meta && meta.decoderConfig && meta.decoderConfig.description) { const d = meta.decoderConfig.description; avcC = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d).slice(); } }, error: e => { err = e; } });
      enc.configure(cfg);
    }, (rgba, delay, W, H) => {
      if (err) return;
      const key = t - lastKey >= 2000 || lastKey < 0;
      if (key) lastKey = t;
      const vf = new VideoFrame(rgba, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: Math.round(t * 1000), duration: Math.round(delay * 1000) });
      queued++; enc.encode(vf, { keyFrame: key }); vf.close(); queued--;
      t += delay;
    }, s, { fps, ropts: { even: true, bgMode: S.bgMode === 'transparent' ? 'solid' : undefined }, throttle });
    progress(0.95, 'Finishing…');
    await enc.flush(); enc.close();
    if (err) throw err;
    chunks.sort((a, b) => a.t - b.t);
    // an animation can repeat: the encoded frames are reused (every pass starts with a key frame)
    const reps = s.kind === 'anim' ? Math.max(1, Math.round(S.animRepeat)) : 1, one = chunks.slice();
    for (let r = 1; r < reps; r++) for (const c of one) chunks.push({ data: c.data, t: c.t + r * t, key: c.key });
    const total = t * reps;
    const blob = ext === 'mp4' ? mp4File(cfg.width, cfg.height, avcC, chunks, total) : webmFile(cfg.width, cfg.height, cfg.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', chunks, total);
    download(blob, baseName() + '.' + ext);
    toast(`${label} saved (${fmtBytes(blob.size)}, ${fmtTime(total / 1000)})`);
  });
}
/* the video buttons: fast encoding when possible; real-time recording keeps a video's own sound */
function exportVideoAny(ext) {
  const rec = VIDEO_FORMATS.find(f => f.ext === ext), wantsAudio = App.src && App.src.kind === 'video' && S.includeAudio;
  if (FAST_VIDEO_OK && !(wantsAudio && rec)) return exportVideoFast(ext);
  if (rec) return exportVideo(rec);
  toast('This browser cannot save ' + ext.toUpperCase() + ' videos', 'error');
}
async function exportVideo(fmt) {
  const s = App.src;
  await runExport(`Recording ${fmt.label} (real time)`, async progress => {
    const canvas = document.createElement('canvas'), [a, b] = trimRange();
    let scale = null;
    const draw = (d, w, h, t) => {
      const res = convert(d, w, h, settingsAt(t));
      if (scale === null) scale = safeScale(res, S.exportScale);
      renderResult(res, S, canvas, scale, { even: true, bgMode: S.bgMode === 'transparent' ? 'solid' : undefined });
    };
    if (s.kind === 'video') { await seekVideo(s.video, a); draw(s.video, s.video.videoWidth, s.video.videoHeight); }
    else draw(s.frames[frameIndexAt(a)].bmp, s.w, s.h);
    const stream = canvas.captureStream(clamp(S.videoFps, 1, 60));
    const tracks = [...stream.getVideoTracks()];
    const restoreMuted = s.video ? s.video.muted : false;
    if (s.kind === 'video' && S.includeAudio) { s.video.muted = false; tracks.push(...audioTracksFor(s)); }
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: fmt.mime, videoBitsPerSecond: Math.round(S.videoBitrate * 1e6) });
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { rec.onstop = r; });
    rec.start(1000);
    try {
      if (s.kind === 'video') {
        const v = s.video; v.playbackRate = 1;
        await v.play();
        await new Promise(res => {
          let lastT = -1;
          const step = () => {
            if (App.cancel || v.ended || v.paused || v.currentTime >= b - 0.001) return res();
            if (v.currentTime !== lastT) { lastT = v.currentTime; draw(v, v.videoWidth, v.videoHeight, v.currentTime); progress((v.currentTime - a) / Math.max(1e-3, b - a), fmtTime(v.currentTime - a) + ' / ' + fmtTime(b - a) + ' (keep this tab visible)'); }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        v.pause();
      } else {
        const reps = Math.max(1, Math.round(S.animRepeat)), span = b - a, total = span * reps, start = performance.now();
        let last = -1;
        await new Promise(res => {
          const step = () => {
            const el = (performance.now() - start) / 1000;
            if (App.cancel || el >= total) return res();
            const idx = frameIndexAt(a + (el % span));
            if (idx !== last) { last = idx; draw(s.frames[idx].bmp, s.w, s.h, s.frames[idx].t0); }
            progress(el / total, fmtTime(el) + ' / ' + fmtTime(total) + ' (keep this tab visible)');
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      }
    } finally {
      rec.stop(); await stopped;
      stream.getVideoTracks().forEach(t => t.stop());
      if (s.video) s.video.muted = restoreMuted;
    }
    if (App.cancel) throw cancelled();
    const blob = new Blob(chunks, { type: fmt.mime.split(';')[0] });
    download(blob, baseName() + '.' + fmt.ext);
    toast(`${fmt.label} saved (${fmtBytes(blob.size)})`);
  });
}
/* the result of every export frame (converted on workers where needed) with its delay */
async function collectResults(progress) {
  const jobs = new OrderedJobs(), delays = [];
  for await (const f of exportFrames()) {   // frames not converted yet are converted on workers, several at once
    if (App.cancel) throw cancelled();
    delays.push(Math.round(f.delay));
    const St = frameSettings(f), memo = f.text != null ? textResult(f.text, S, f.ansi) : peekResult(f.d, f.w, f.h, St);
    if (memo) await jobs.add(null, () => withOverlay(memo, St));
    else {
      const key = memoKey(f.d, f.w, f.h, St), a = Pool.size() ? frameJobArgs(f, St) : null;
      await jobs.add(a && (() => Pool.run('convertPre', { pre: a.pre, sw: a.sw, sh: a.sh, St }).then(r => { if (key) resultCache.set(key, r, resultBytes(r)); return withOverlay(r, St); })), () => a ? frameJobResult(a, St) : frameResult(f));
    }
    progress(jobs.done / f.total, `Frame ${f.index + 1} / ${f.total}`);
    await nextTick();
  }
  return (await jobs.all()).map((res, i) => ({ res, d: delays[i] }));
}
async function collectFrames(withColors, progress) {
  const frames = [], all = await collectResults(progress);
  for (let i = 0; i < all.length; i++) {
    const res = all[i].res;
    const fr = { t: resultText(res), d: all[i].d };
    if (withColors && !res.uniform) {
      let bin = ''; const u = res.fg;
      for (let j = 0; j < u.length; j += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(j, j + 0x8000));
      fr.c = btoa(bin);
    }
    frames.push(fr);
  }
  return frames;
}
async function exportFramesText(kind) {
  if (!confirmLarge(countFrames())) return;
  await runExport('Converting frames to text', async progress => {
    const frames = await collectFrames(false, progress);
    if (kind === 'json') {
      const body = JSON.stringify({ generator: 'Text Art Studio', mode: S.mode, frameCount: frames.length, frames: frames.map(f => ({ delayMs: f.d, text: f.t })) });
      download(new Blob([body], { type: 'application/json' }), baseName() + '_frames.json');
    } else {
      const body = frames.map((f, i) => `=== frame ${i + 1}/${frames.length} · ${f.d} ms ===\n${f.t}`).join('\n\n') + '\n';
      download(new Blob([body], { type: 'text/plain;charset=utf-8' }), baseName() + '_frames.txt');
    }
  });
}
const PLAYER_JS = `
const P=document.getElementById('p'),I=document.getElementById('i');let k=0,on=true,tm;
function b64(s){const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function esc(x){return x==='&'?'&amp;':x==='<'?'&lt;':x==='>'?'&gt;':x}
const H=D.frames.map(f=>{if(!f.c)return null;const c=b64(f.c),L=f.t.split('\\n');let o='',q=0;
for(const l of L){let run='',k0=-1;const fl=()=>{if(run)o+='<span style="color:#'+k0.toString(16).padStart(6,'0')+'">'+run+'</span>';run=''};
for(const x of Array.from(l)){const kk=(c[q*3]<<16)|(c[q*3+1]<<8)|c[q*3+2];q++;if(kk!==k0){fl();k0=kk}run+=esc(x)}fl();o+='\\n'}return o});
function show(){const f=D.frames[k];if(H[k])P.innerHTML=H[k];else P.textContent=f.t;I.textContent=(on?'':'paused · ')+(k+1)+' / '+D.frames.length}
function loop(){show();if(!on)return;tm=setTimeout(()=>{k=(k+1)%D.frames.length;loop()},Math.max(16,D.frames[k].d))}
function toggle(){on=!on;clearTimeout(tm);loop()}
function step(d){on=false;clearTimeout(tm);k=(k+d+D.frames.length)%D.frames.length;show()}
document.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();toggle()}else if(e.key==='ArrowRight')step(1);else if(e.key==='ArrowLeft')step(-1)});
P.addEventListener('click',toggle);loop();`;
/* Animated SVG: every frame is a group, shown in turn by a CSS animation with the real frame times. */
async function exportSVGAnim() {
  if (!confirmLarge(countFrames())) return;
  await runExport('Building animated SVG', async progress => {
    const all = await collectResults(progress);
    if (!all.length) return;
    const [W, H, mx, my] = pictureSize(all[0].res.cols, all[0].res.rows, S, 1);
    const total = all.reduce((t, f) => t + Math.max(10, f.d), 0), pct = v => (v / total * 100).toFixed(4).replace(/\.?0+$/, '');
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, '<style>'];
    let t = 0;
    all.forEach((f, i) => {
      const a = t, b = t + Math.max(10, f.d); t = b;
      parts.push(`@keyframes k${i}{0%{visibility:hidden}${a ? `${pct(a)}%{visibility:visible}` : '0%{visibility:visible}'}${b < total ? `${pct(b)}%{visibility:hidden}` : ''}}`);
    });
    parts.push(`.f{visibility:hidden;animation:${(total / 1000).toFixed(3)}s step-end infinite}</style>`);
    if (S.bgMode !== 'transparent') parts.push(`<rect width="100%" height="100%" fill="${S.bg}"/>`);
    all.forEach((f, i) => { parts.push(`<g class="f" style="animation-name:k${i}"${mx || my ? ` transform="translate(${mx} ${my})"` : ''}>`); svgBody(f.res, S, parts); parts.push('</g>'); });
    parts.push('</svg>');
    const blob = new Blob([parts.join('\n')], { type: 'image/svg+xml' });
    download(blob, baseName() + '_anim.svg');
    toast(`Animated SVG saved (${fmtBytes(blob.size)})`);
  });
}
async function exportHTMLPlayer() {
  if (!confirmLarge(countFrames())) return;
  await runExport('Building HTML player', async progress => {
    const frames = await collectFrames(true, progress);
    const data = JSON.stringify({ frames }).replace(/</g, '\\u003c');
    const bg = S.bgMode === 'transparent' ? '#000' : S.bg;
    const html = `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHTML(baseName())}</title>\n<style>html,body{margin:0;min-height:100%;background:${bg}}body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:10px}pre{margin:0;${preStyle(S)}color:${S.fg};white-space:pre;cursor:pointer;user-select:text}#i{font:12px system-ui,sans-serif;color:${S.fg};opacity:.55}</style></head>\n<body><pre id="p"></pre><div id="i"></div>\n<script>const D=${data};${PLAYER_JS}<\/script></body></html>\n`;
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), baseName() + '_player.html');
  });
}
async function exportZip() {
  if (!confirmLarge(countFrames())) return;
  await runExport('Rendering PNG frames', async progress => {
    const files = [], canvas = document.createElement('canvas'), enc = new TextEncoder();
    const png = async c => new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
    const jobs = new OrderedJobs();
    let scale = null;
    for await (const f of exportFrames()) {
      if (App.cancel) throw cancelled();
      // workers convert, draw and compress several frames at once; this thread only resamples the source
      const St = frameSettings(f), a = Pool.size() ? frameJobArgs(f, St) : { res: frameResult(f) };
      if (scale === null) scale = safeScale(a.res || gridFor(f.w, f.h, S), S.exportScale);
      Object.assign(a, { St, scale });
      const local = async () => { const res = frameJobResult(a, St); renderResult(res, S, canvas, scale); const p = png(canvas); return { png: await p, text: resultText(res) }; };
      await jobs.add(() => Pool.run('pngFrame', a), local);
      progress(jobs.done / f.total, `Frame ${f.index + 1} / ${f.total}`);
      await nextTick();
    }
    const outs = await jobs.all(k => progress(k / jobs.count, `Compressing ${k} / ${jobs.count}`));
    outs.forEach((o, i) => { const n = String(i + 1).padStart(5, '0'); files.push({ name: `png/frame_${n}.png`, data: o.png }, { name: `text/frame_${n}.txt`, data: enc.encode(o.text) }); });
    const blob = await makeZipAsync(files, p => progress(p, 'Compressing the text frames…'));
    download(blob, baseName() + '_frames.zip');
    toast(`ZIP saved (${fmtBytes(blob.size)})`);
  });
}
function toggleLiveRecord() {
  if (App.recorder) { App.recorder.stop(); return; }
  const fmt = VIDEO_FORMATS[0]; if (!fmt) return toast('Video recording is not supported in this browser', 'error');
  const stream = $('#outCanvas').captureStream(clamp(S.videoFps, 1, 60));
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: Math.round(S.videoBitrate * 1e6) });
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach(t => t.stop()); App.recorder = null; buildExportPanel();
    if (chunks.length) download(new Blob(chunks, { type: fmt.mime.split(';')[0] }), baseName() + '_live.' + fmt.ext);
  };
  rec.start(1000); App.recorder = rec; buildExportPanel(); toast('Recording… press Stop to save');
}

function buildExportPanel() {
  const body = $('#exportBody'); body.innerHTML = '';
  const s = App.src;
  if (!s) { body.innerHTML = '<p class="muted small">Open an image, GIF or video. The export formats available depend on the input type.</p>'; return; }
  const animated = s.kind === 'anim' || s.kind === 'video';
  const section = (title, sub) => {
    const d = document.createElement('section'); d.className = 'xsec';
    d.innerHTML = `<h3>${title}${sub ? `<span class="muted">${sub}</span>` : ''}</h3><div class="xbtns"></div>`;
    body.appendChild(d); return d;
  };
  /* opt.more: the button goes into the section's "More formats" fold (kept short for first-time users) */
  const moreOf = (sec, name) => {
    let d = sec.querySelector(':scope > details.xmore');
    if (!d) { d = document.createElement('details'); d.className = 'xmore fold'; d.dataset.fold = 'x-' + name; d.innerHTML = '<summary>More formats</summary><div class="xbtns"></div>'; sec.insertBefore(d, sec.querySelector(':scope > .xopts')); initFold(d); }
    return d.querySelector('.xbtns');
  };
  const btn = (sec, label, fn, opt = {}) => {
    const b = document.createElement('button'); b.className = 'btn' + (opt.primary ? ' primary' : ''); b.textContent = label;
    if (opt.est) { b.dataset.est = opt.est; b.classList.add('hasz'); const z = document.createElement('small'); z.className = 'sz'; b.appendChild(z); }
    if (opt.title) b.title = opt.title; b.addEventListener('click', fn); (opt.more ? moreOf(sec, opt.more) : sec.querySelector('.xbtns')).appendChild(b); return b;
  };
  const opts = (sec, html) => { const d = document.createElement('div'); d.className = 'xopts'; d.innerHTML = html; sec.appendChild(d); bindControls(d); };
  const frameNote = animated ? 'current frame' : s.kind === 'webcam' ? 'snapshot' : '';

  const sh = section('Send as text to a chat app', frameNote); sh.dataset.goal = 'chat';
  sh.classList.add('share');
  sh.insertAdjacentHTML('beforeend', `<div class="row"><label>Where will you paste it?</label><select data-key="platform">${Object.entries(PLATFORMS).map(([k, p]) => `<option value="${k}">${escHTML(p.name)}</option>`).join('')}</select></div>
    <div class="row" id="shareTargetRow"><label>Mostly viewed on</label><select data-key="shareTarget"><option value="phone">Phone (narrow, safest)</option><option value="desktop">Desktop / web (about 2× wider)</option></select></div>
    <div class="row" id="shareSplitRow"><label class="chk"><input type="checkbox" data-key="shareSplit"> Split into several messages if too long (keeps more detail)</label></div>
    <div class="row"><label>Chat theme</label><select data-key="shareTheme"><option value="auto" id="shareThemeAuto">Auto</option><option value="dark">Dark mode</option><option value="light">Light mode</option></select></div>
    <div class="row" id="shareColorRow"><label class="chk"><input type="checkbox" data-key="shareColor"> Colour copy (Discord desktop/web, 8 colours)</label></div>
    <div id="shareBox"><div class="verdict ok" id="shareVerdict">…</div>
      <div id="fixAllBox" class="fixall" hidden><button class="btn primary" id="fixAllBtn">✨ Fix all</button><div class="muted small">Builds a platform-ready copy. Your main settings and preview stay unchanged.</div></div>
      <div id="optBox" class="optbox" hidden><div class="opthead"><b id="optTitle">Fixed copy</b><span>main settings unchanged</span></div><ul id="optChanges"></ul>
        <div class="xbtns"><button class="btn" id="optOff" title="Copy using your own settings again">Use my settings</button><button class="btn" id="optApply" title="Also change the main settings to these values">Apply to editor</button></div></div>
      <ul class="checks" id="shareChecks"></ul></div>`);
  sh.querySelector('#fixAllBtn').addEventListener('click', () => { setShareOptimize(true); toast('Fixed copy ready. Your main settings are unchanged'); });
  sh.querySelector('#optOff').addEventListener('click', () => setShareOptimize(false));
  sh.querySelector('#optApply').addEventListener('click', applyFixToEditor);
  sh.insertAdjacentHTML('beforeend', `<div class="xbtns" id="shareCopyBtns"></div>
    <p class="muted small" id="sharePartsNote" hidden style="margin:6px 0 0">Paste each part as its own message, in order. They stack into the full picture.</p>
    <div class="xbtns" style="margin-top:6px"><button class="btn" id="sharePrev" title="Show roughly how it will look on the platform">Preview</button>${canShareText() ? '<button class="btn" id="shareSend" title="Send the text straight to an app (share sheet)">Share to an app…</button>' : ''}</div>`);
  if (sh.querySelector('#shareSend')) sh.querySelector('#shareSend').addEventListener('click', actShareText);
  sh.querySelector('#sharePrev').addEventListener('click', () => setView('platform'));
  sh.insertAdjacentHTML('beforeend', '<p class="muted small" style="margin:8px 0 0">Colours, animation and exact layout are only kept when you send an <b>image, GIF or video</b> (see below).</p>');
  bindControls(sh);

  const t = section('Text', animated ? 'current frame' : ''); t.dataset.goal = 'text';
  btn(t, 'Copy text', actCopyText, { title: 'Copy unformatted plain text (best for Notepad / code editors)' });
  btn(t, 'Copy with colours', actCopyHTML, { title: 'Copy as coloured rich text, for Word, Google Docs or an email' });
  btn(t, '.txt', () => saveText('txt'), { title: 'Plain UTF-8 text file' });
  btn(t, 'Copy ANSI', actCopyANSI, { title: 'Copy with 24-bit colour escape codes for terminals', more: 'text' });
  btn(t, '.html', () => saveText('html'), { title: 'Web page (keeps colours)', more: 'text' });
  btn(t, '.ans', () => saveText('ans'), { title: 'ANSI art file for terminals', more: 'text' });
  btn(t, '.svg', () => saveText('svg'), { title: 'Scalable vector image', more: 'text' });
  moreOf(t, 'text').parentNode.insertAdjacentHTML('beforeend', `<div class="xopts"><div class="row"><label for="codeLang">Copy as code</label><div class="inline"><select id="codeLang"><option value="js">JavaScript</option><option value="py">Python</option><option value="cs">C#</option><option value="json">JSON</option></select><button class="btn" id="codeCopy" title="The text as a string you can paste into a program">Copy</button></div></div>
    ${animated ? '' : '<div class="row"><label>Terminal script <span class="muted">prints it in colour</span></label><div class="xbtns" id="scriptBtns"></div></div>'}</div>`);
  t.querySelector('#codeCopy').addEventListener('click', actCopyCode);
  btn(t, '🔗 Copy link', actCopyLink, { title: 'A link that opens this text art (with its colours) in Text Art Studio. The art is inside the link: nothing is uploaded', more: 'text' });
  if (!animated) for (const k of ['sh', 'ps1', 'py']) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = '.' + k; b.title = ({ sh: 'Shell script (macOS, Linux, Git Bash)', ps1: 'PowerShell script (Windows)', py: 'Python script (any computer)' })[k]; b.addEventListener('click', () => exportTerminalScript(k)); t.querySelector('#scriptBtns').appendChild(b); }

  if (s.kind !== 'text' || true) {
    const qs = section('Size &amp; quality', ''); qs.dataset.goal = 'save'; qs.classList.add('quality');
    qs.querySelector('.xbtns').remove();
    qs.insertAdjacentHTML('beforeend', `<div class="qseg" id="qualitySeg">${Object.entries(QUALITY).map(([k, q]) => `<button data-q="${k}"><b>${q.name}</b><small>${q.note}</small></button>`).join('')}</div>
      <p class="muted small" id="qualityCustom" hidden style="margin:4px 0 0">Custom settings (changed by hand).</p>
      <div class="sizeinfo" id="sizeInfoBox">…</div>
      <p class="muted small" style="margin:6px 0 0">Sizes are shown on each button below. Fewer characters (Adjust → Width) also makes files smaller.</p>`);
    $$('#qualitySeg button', qs).forEach(b => b.addEventListener('click', () => applyQuality(b.dataset.q)));
  }
  const im = section(animated ? 'Picture of this frame' : 'Picture', ''); im.dataset.goal = 'save';
  IMG_FORMATS.forEach((f, i) => btn(im, f.label, () => saveImage(f), { primary: i === 0, est: f.ext }));
  btn(im, 'Copy image', actCopyImage, { title: 'Copy PNG to the clipboard' });
  if (canShareFiles('image/png')) btn(im, 'Share…', actSharePicture, { title: 'Send the picture to another app (share sheet)' });
  opts(im, `<div class="row adv"><label>Scale <output data-out="exportScale" data-suffix="×"></output></label><input type="range" data-key="exportScale" min="0.5" max="4" step="0.25"></div>
    <div class="row adv"><label>JPG / WEBP quality <output data-out="quality"></output></label><input type="range" data-key="quality" min="0.3" max="1" step="0.01"></div>`);

  if (animated) {
    const an = section('Animation', 'uses the trim range'); an.dataset.goal = 'save';
    btn(an, 'GIF', exportGIF, { primary: true, title: 'Animated GIF of the text frames', est: 'gif' });
    if (canShareFiles('image/gif')) btn(an, 'Share GIF…', actShareGIF, { title: 'Make the GIF and send it to another app (share sheet)' });
    const vids = FAST_VIDEO_OK ? [{ label: 'MP4', ext: 'mp4' }, { label: 'WEBM', ext: 'webm' }] : VIDEO_FORMATS;
    vids.forEach(f => btn(an, f.label, () => exportVideoAny(f.ext), { title: `Save a ${f.label} video`, est: f.ext }));
    if (APNG_OK) btn(an, 'APNG', () => exportAnimated('apng'), { title: 'Animated PNG: every colour kept exactly, plays in all modern browsers', more: 'anim' });
    if (ANIM_WEBP_OK) btn(an, 'WEBP anim', () => exportAnimated('webp'), { title: 'Animated WEBP: full colour, small for colourful pictures (fine dot art is usually smaller as GIF or APNG). Quality = JPG / WEBP quality', more: 'anim' });
    btn(an, 'Frames .txt', () => exportFramesText('txt'), { title: 'Every frame as text in one file', more: 'anim' });
    btn(an, 'Animated .svg', exportSVGAnim, { title: 'Scalable animation that plays in any browser (best for short clips)', more: 'anim' });
    btn(an, 'Frames .json', () => exportFramesText('json'), { title: 'Every frame as text with delays (JSON)', more: 'anim' });
    btn(an, 'HTML player', exportHTMLPlayer, { title: 'Stand-alone web page that plays the text animation', more: 'anim' });
    btn(an, 'PNG frames .zip', exportZip, { title: 'ZIP of PNG + TXT for every frame', more: 'anim' });
    btn(an, 'Terminal .sh', () => exportTerminalScript('sh'), { title: 'Shell script that plays the animation in a terminal, in colour (macOS, Linux, Git Bash)', more: 'anim' });
    btn(an, 'Terminal .ps1', () => exportTerminalScript('ps1'), { title: 'PowerShell script that plays the animation in Windows Terminal, in colour', more: 'anim' });
    btn(an, 'Terminal .py', () => exportTerminalScript('py'), { title: 'Python script that plays the animation in any terminal, in colour', more: 'anim' });
    let o = '';
    if (s.kind === 'video') o += `<div class="row"><label>Frames per second (GIF / text) <output data-out="gifFps"></output></label><input type="range" data-key="gifFps" min="1" max="30" step="1"></div>`;
    else o += `<div class="row"><label>Use every Nth frame <output data-out="frameStep"></output></label><input type="range" data-key="frameStep" min="1" max="10" step="1"></div>`;
    o += `<div class="row"><label>GIF colours <output data-out="gifColors"></output></label><input type="range" data-key="gifColors" min="2" max="256" step="1"></div>`;
    o += `<div class="row"><label class="chk" title="Each frame stores only the part that changed. Much smaller files, same picture"><input type="checkbox" data-key="gifDiff"> Smaller files: store only what changes</label></div>`;
    o += `<div class="row adv"><label>GIF palette</label><select data-key="gifPalette"><option value="frame">Own colours per frame (best colours)</option><option value="global">One palette for all frames (smaller, no colour flicker)</option></select></div>`;
    o += `<div class="row adv"><label class="chk" title="Mixes palette colours in small patterns, so gradients show no bands"><input type="checkbox" data-key="gifDither"> Smooth colour gradients (dithering)</label></div>`;
    o += `<div class="row"><label>Video FPS <output data-out="videoFps"></output></label><input type="range" data-key="videoFps" min="5" max="60" step="1"></div>`;
    o += `<div class="row"><label>Video bitrate (Mbit/s) <output data-out="videoBitrate"></output></label><input type="range" data-key="videoBitrate" min="1" max="40" step="1"></div>`;
    if (s.kind === 'video') o += `<div class="row"><label class="chk"><input type="checkbox" data-key="includeAudio"> Include original audio in video</label></div>`;
    else o += `<div class="row"><label>Video: repeat loop <output data-out="animRepeat" data-suffix="×"></output></label><input type="range" data-key="animRepeat" min="1" max="20" step="1"></div>`;
    o = `<details class="fold xoptfold" data-fold="x-animopts"><summary>Animation options (frames, colours, quality)</summary>${o}`;
    o += `<p class="muted small" style="margin:6px 0 0">${FAST_VIDEO_OK ? (s.kind === 'video' ? 'Videos are encoded as fast as your computer allows. With "Include original audio" they are recorded in real time instead (keep this tab visible).' : 'Videos are encoded as fast as your computer allows.') : VIDEO_FORMATS.length ? 'Video files are recorded in real time. Keep this tab visible while recording.' : 'Video recording is not supported in this browser. GIF, text and ZIP still work.'}</p></details>`;
    opts(an, o); initFold(an.querySelector('details.xoptfold'));
  }
  { const st = section('Stickers &amp; emoji', animated ? 'animated' : ''); st.dataset.goal = 'save';
    const d = document.createElement('details'); d.className = 'fold xstick'; d.dataset.fold = 'x-stickers';
    d.innerHTML = `<summary>Discord, Slack &amp; Telegram sizes</summary><div class="xbtns"></div><p class="muted small" style="margin:6px 0 0">Square, in each app's size and file limit (made smaller automatically when needed).</p>`;
    st.querySelector('.xbtns').replaceWith(d); initFold(d);
    for (const [id, P] of Object.entries(STICKERS)) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = P.name; b.title = P.note + '. Made to fit: fewer colours or frames when needed'; b.addEventListener('click', () => exportSticker(id)); d.querySelector('.xbtns').appendChild(b); } }
  if (s.kind === 'webcam') {
    const lv = section('Live recording'); lv.dataset.goal = 'save';
    btn(lv, App.recorder ? '■ Stop & save' : '● Record video', toggleLiveRecord, { primary: true });
    opts(lv, `<div class="row"><label>Video FPS <output data-out="videoFps"></output></label><input type="range" data-key="videoFps" min="5" max="60" step="1"></div>`);
  }
  applyGoal();
}

