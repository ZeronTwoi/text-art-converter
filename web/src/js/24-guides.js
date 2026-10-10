/* =====================================================================
   Visual guides: the character ramp from light to dense, and a brightness histogram next to the tone sliders
   ===================================================================== */
function updateRampStrip() {
  const box = $('#rampStrip'); if (!box) return;
  const ramp = S.mode === 'ascii' || S.mode === 'edge' ? getRamp(S) : S.mode === 'halftone' ? HALFTONE_RAMP : null;
  const key = ramp && ramp.join('') + '|' + S.fg + '|' + S.bg + '|' + fontCss(S);
  if (box._key === key) return; box._key = key;
  box.hidden = !ramp; if (!ramp) return;
  box.style.background = S.bg; box.style.color = S.fg; box.style.fontFamily = fontCss(S);
  box.textContent = '';
  ramp.forEach((ch, i) => {
    const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch;
    s.title = `${i + 1} of ${ramp.length}: ${ch === ' ' ? 'space' : '"' + ch + '"'} ${uplus(ch.codePointAt(0))}`;
    box.appendChild(s);
  });
  box.setAttribute('aria-label', `${ramp.length} characters from light to dense: ${ramp.join(' ').trim()}`);
}
/* brightness of the picture as the engine sees it, before and after the light settings (64 bins each) */
function toneHistogram(data, S) {
  const before = new Float64Array(64), after = new Float64Array(64), n = data.length / 4;
  const c0 = clamp(S.contrast, -1, 0.98), cf = (1 + c0) / (1 - c0), br = S.brightness, sat = S.saturation, ig = 1 / clamp(S.gamma, 0.05, 10);
  const curve = v => { v = (v - 0.5) * cf + 0.5 + br; v = v < 0 ? 0 : v > 1 ? 1 : v; return ig !== 1 ? Math.pow(v, ig) : v; };
  const T = new Float64Array(256); for (let v = 0; v < 256; v++) T[v] = curve(v / 255);
  const Ls = new Float32Array(n); let cnt = 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    if (data[o + 3] < 128) { Ls[i] = -1; continue; }
    const R = data[o], G = data[o + 1], B = data[o + 2];
    before[Math.min(63, ((0.299 * R + 0.587 * G + 0.114 * B) / 255 * 64) | 0)]++;
    let L;
    if (sat === 1) L = 0.299 * T[R] + 0.587 * T[G] + 0.114 * T[B];
    else {
      let r = (R / 255 - 0.5) * cf + 0.5 + br, g = (G / 255 - 0.5) * cf + 0.5 + br, b = (B / 255 - 0.5) * cf + 0.5 + br;
      const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      r = clamp(r, 0, 1); g = clamp(g, 0, 1); b = clamp(b, 0, 1);
      if (ig !== 1) { r = Math.pow(r, ig); g = Math.pow(g, ig); b = Math.pow(b, ig); }
      L = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    Ls[i] = L; cnt++;
  }
  let lo = 0, hi = 1;
  if (S.autoLevels && cnt) {   // the same 1% stretch the engine applies
    const h = new Uint32Array(256); for (const L of Ls) if (L >= 0) h[(L * 255) | 0]++;
    let a = 0, l = 0, u = 255; for (; l < 255; l++) { a += h[l]; if (a > cnt * 0.01) break; } a = 0; for (; u > 0; u--) { a += h[u]; if (a > cnt * 0.01) break; }
    if (u - l > 4) { lo = l / 255; hi = u / 255; }
  }
  let black = 0, white = 0;
  for (let L of Ls) {
    if (L < 0) continue;
    if (hi - lo < 1) L = clamp((L - lo) / (hi - lo), 0, 1);
    if (S.invert) L = 1 - L;
    after[Math.min(63, (L * 64) | 0)]++;
    if (L <= 0.004) black++; else if (L >= 0.996) white++;
  }
  return { before, after, count: cnt, black: cnt ? black / cnt : 0, white: cnt ? white / cnt : 0 };
}
let histTimer = 0, histLast = 0;
function scheduleHistogram() {
  if ($('#settings .tab[data-tab="adjust"]').hidden || !App.src || App.src.kind === 'text') return;
  clearTimeout(histTimer);
  const wait = Math.max(0, 120 - (performance.now() - histLast));
  histTimer = setTimeout(drawHistogram, App.playing ? Math.max(wait, 250) : wait);
}
function drawHistogram() {
  histLast = performance.now();
  const c = $('#toneHist'), info = $('#toneInfo'), d = App.src && App.src.kind !== 'text' ? currentDrawable() : null;
  if (!c || !d) return;
  const St = Object.assign({}, S), { W, H } = gridFor(d[1], d[2], St);
  let data;
  try { data = samplePixels(d[0], d[1], d[2], St, W, H, srcKey(d[0])); } catch (e) { return; }
  const h = toneHistogram(data, St), dpr = window.devicePixelRatio || 1, cw = Math.max(100, c.clientWidth), ch = 46;
  if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const css = getComputedStyle(document.documentElement), accent = css.getPropertyValue('--accent').trim() || '#6ee7b7', muted = css.getPropertyValue('--muted').trim() || '#888';
  const max = Math.max(1, ...h.before, ...h.after), bw = cw / 64, y = v => ch - 2 - Math.sqrt(v / max) * (ch - 6);
  g.fillStyle = muted; g.globalAlpha = 0.35;
  for (let i = 0; i < 64; i++) g.fillRect(i * bw, y(h.before[i]), Math.max(1, bw - 0.5), ch - 2 - y(h.before[i]));
  g.globalAlpha = 1; g.strokeStyle = accent; g.lineWidth = 1.5; g.beginPath();
  for (let i = 0; i < 64; i++) { const x = i * bw + bw / 2; i ? g.lineTo(x, y(h.after[i])) : g.moveTo(x, y(h.after[i])); }
  g.stroke();
  if (['braille', 'quad', 'half', 'word'].includes(S.mode)) {   // threshold: where dots start (two-level styles)
    g.strokeStyle = css.getPropertyValue('--text').trim() || '#fff'; g.setLineDash([3, 3]); g.lineWidth = 1;
    const tx = clamp(S.threshold, 0, 1) * cw; g.beginPath(); g.moveTo(tx, 0); g.lineTo(tx, ch); g.stroke(); g.setLineDash([]);
  }
  const pc = v => v >= 0.0995 ? Math.round(v * 100) + '%' : v >= 0.001 ? (v * 100).toFixed(1) + '%' : '0%';
  info.textContent = `After your settings: ${pc(h.black)} pure black, ${pc(h.white)} pure white` + (h.black > 0.25 || h.white > 0.25 ? ' (detail lost)' : '');
  info.classList.toggle('warn', h.black > 0.25 || h.white > 0.25);
}
function initGuides() {
  updateRampStrip();
  $$('#leftTabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'adjust') setTimeout(drawHistogram, 0); }));
  window.addEventListener('resize', scheduleHistogram);
}
