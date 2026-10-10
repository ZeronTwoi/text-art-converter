/* =====================================================================
   Effects that turn a still picture into an animation: typewriter reveal, Matrix rain, glitch, scanlines,
   slow zoom. The frames are drawn once into an ordinary animation, so playback, every animated export,
   edits, captions and projects work with them as with any GIF. Every effect loops seamlessly.
   ===================================================================== */
const EFFECTS = {
  typewriter: 'Typewriter reveal',
  rain: 'Matrix rain',
  glitch: 'Glitch',
  scan: 'Scanlines & flicker',
  zoom: 'Slow zoom (Ken Burns)',
};
/* draws frame k of N of an effect into g (W×H) from the still picture b */
function drawEffectFrame(kind, g, b, k, N, W, H, grid, bg) {
  const t = k / N, TAU = Math.PI * 2;
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  if (kind === 'zoom') {   // in and back out, focused a little above the middle
    const z = 1 + 0.32 * (0.5 - 0.5 * Math.cos(TAU * t)), sw = W / z, sh = H / z;
    g.drawImage(b, (W - sw) * (0.5 + 0.12 * Math.sin(TAU * t)), (H - sh) * 0.42, sw, sh, 0, 0, W, H);
  } else g.drawImage(b, 0, 0, W, H);
  const { cols, rows } = grid, cw = W / cols, ch = H / rows;
  if (kind === 'typewriter') {   // cells appear in reading order behind a blinking cursor, then the picture holds
    const total = cols * rows, shown = Math.min(total, Math.floor(total * Math.min(1, t / 0.78)));
    const r0 = Math.floor(shown / cols), c0 = shown % cols;
    g.fillStyle = bg;
    if (shown < total) { g.fillRect(c0 * cw, r0 * ch, W - c0 * cw, ch); g.fillRect(0, (r0 + 1) * ch, W, H - (r0 + 1) * ch); }
    if (shown < total && (k >> 1) % 2 === 0) { g.fillStyle = lumRGB(hexToRgb(bg)) < 0.5 ? '#ffffff' : '#000000'; g.fillRect(c0 * cw, r0 * ch, Math.max(cw, 2), ch); }
  } else if (kind === 'rain') {   // darker picture, bright drops falling down the character columns
    g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter'; g.filter = `blur(${Math.max(0.5, cw * 0.3).toFixed(1)}px)`;   // soft sides: drops, not outlined bars
    for (let x = 0; x < cols; x++) {
      const h1 = hashNoise(x, 17); if (h1 < 0.3) continue;
      const speed = 1 + Math.floor(hashNoise(x, 91) * 3), len = (0.2 + 0.45 * hashNoise(x, 5)) * H;
      const head = ((t * speed + h1 * 7) % 1) * (H + len);
      const gr = g.createLinearGradient(0, head - len, 0, head);
      gr.addColorStop(0, 'rgba(40,255,110,0)'); gr.addColorStop(0.82, 'rgba(60,255,120,0.6)'); gr.addColorStop(1, 'rgba(225,255,232,1)');
      g.fillStyle = gr; g.fillRect(x * cw, head - len, cw, len);
    }
  } else if (kind === 'glitch') {   // calm, then bursts of shifted slices, a colour echo and a noise bar
    const burst = hashNoise(k, 3) < 0.3 || k % Math.max(4, Math.round(N / 3)) < 2;
    if (burst) {
      const n = 3 + Math.floor(hashNoise(k, 4) * 6);
      for (let i = 0; i < n; i++) {
        const y = hashNoise(k, 10 + i) * H, h = (0.02 + 0.09 * hashNoise(k, 30 + i)) * H, dx = (hashNoise(k, 50 + i) - 0.5) * W * 0.14;
        g.drawImage(b, 0, y, W, h, dx, y, W, h);
      }
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.28;
      g.drawImage(b, W * 0.012 * (hashNoise(k, 70) > 0.5 ? 1 : -1), 0, W, H);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      const by = hashNoise(k, 80) * H; g.fillStyle = `rgba(255,255,255,${0.25 + 0.4 * hashNoise(k, 81)})`; g.fillRect(0, by, W, Math.max(2, ch * 0.6));
    }
  } else if (kind === 'scan') {   // dark lines on every other text row, a rolling bright band, a little flicker
    g.fillStyle = 'rgba(0,0,0,0.33)'; for (let y = 1; y < rows; y += 2) g.fillRect(0, y * ch, W, ch);
    const band = H * 0.18, y0 = ((t * 1) % 1) * (H + band) - band, gr = g.createLinearGradient(0, y0, 0, y0 + band);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, y0, W, band);
    const f = hashNoise(k, 99); if (f > 0.7) { g.fillStyle = `rgba(0,0,0,${(f - 0.7) * 0.6})`; g.fillRect(0, 0, W, H); }
  }
  g.restore();
}
/* Make an animation of the open still picture (or of a file: a project being opened). quiet: no toast. */
async function makeEffectAnim(kind, opts = {}, file = null, quiet = false) {
  if (!EFFECTS[kind]) kind = 'typewriter';
  if (App.exporting) return toast('Wait for the export to finish first');
  let base, name, bytes, mime, own = false;
  const s = App.src;
  if (file) { base = await createImageBitmap(file); own = true; name = file.name; bytes = new Uint8Array(await file.arrayBuffer()); mime = file.type || 'image/png'; }
  else if (s && s.effect) ({ still: base, name, bytes, mime } = s.effect);
  else if (s && s.kind === 'image') {
    base = s.bmp; name = s.name || 'picture.png';
    if (s.file) { bytes = new Uint8Array(await s.file.arrayBuffer()); mime = s.file.type || s.mime || 'image/png'; }
    else { const c = document.createElement('canvas'); c.width = s.w; c.height = s.h; c.getContext('2d').drawImage(s.bmp, 0, 0); bytes = new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer()); mime = 'image/png'; name = name.replace(/\.[^.]+$/, '') + '.png'; }
  } else return toast('Open a still picture first');
  const secs = clamp(+opts.seconds || 3, 1, 10), fps = 15, N = Math.max(2, Math.round(secs * fps));
  // frames up to 1024 px, and at most ~160 MB of frames in all
  let k = Math.min(1, 1024 / Math.max(base.width, base.height));
  k = Math.min(k, Math.sqrt(160e6 / (N * 4 * base.width * base.height)));
  const W = Math.max(8, Math.round(base.width * k)), H = Math.max(8, Math.round(base.height * k));
  const still = document.createElement('canvas'); still.width = W; still.height = H; still.getContext('2d').drawImage(base, 0, 0, W, H);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), grid = gridFor(W, H, Object.assign({}, S, { cropL: 0, cropR: 0, cropT: 0, cropB: 0, rotate: 0 }));
  App.cancel = false; showProgress('Making the animation: ' + EFFECTS[kind]);
  const frames = [];
  try {
    for (let i = 0; i < N; i++) {
      if (App.cancel) throw cancelled();
      drawEffectFrame(kind, g, still, i, N, W, H, grid, S.bg);
      frames.push({ bmp: await createImageBitmap(c), delay: 1000 / fps });
      if (i % 4 === 3) { setProgress((i + 1) / N, `Frame ${i + 1} / ${N}`); await nextTick(); }
    }
  } catch (e) {
    for (const f of frames) f.bmp.close();
    hideProgress(); if (own) base.close();
    if (e && e.cancelled) { toast('Cancelled'); return; }
    throw e;
  }
  hideProgress();
  const stillBmp = await createImageBitmap(still); if (own) base.close();
  const a = makeAnim(frames, W, H);
  a.name = name.replace(/\.[^.]+$/, '') + '-' + kind + '.gif';
  a.effect = { kind, opts: { seconds: secs }, still: stillBmp, name, bytes, mime, ext: ((name.match(/\.[A-Za-z0-9]{1,5}$/) || ['.png'])[0]).toLowerCase() };
  setSource(a);
  if (!quiet) toast(`${EFFECTS[kind]}: ${N} frames. Save it as GIF, MP4, WEBP or APNG on the right` + (kind === 'rain' && outlineAmount(S) > 0.3 && S.mode !== 'half' ? '. Tip: lower Outlines (Adjust) for cleaner drops' : ''));
  return a;
}
function backToStill() {
  const e = App.src && App.src.effect; if (!e) return;
  openFile(new File([e.bytes], e.name, { type: e.mime }));
}
function updateEffectsUI() {
  const s = App.src, fx = !!(s && s.effect);
  document.body.toggleAttribute('data-fx', fx);
  $('#fxBack').hidden = !fx;
  $('#fxMake').textContent = fx ? '↻ Use this effect instead' : '▶ Make the animation';
  if (fx) { $('#fxKind').value = s.effect.kind; $('#fxSecs').value = s.effect.opts.seconds; }
  $('#fxSecsOut').textContent = $('#fxSecs').value + ' s';
}
function initEffects() {
  const sel = $('#fxKind');
  for (const [k, n] of Object.entries(EFFECTS)) { const o = document.createElement('option'); o.value = k; o.textContent = n; sel.appendChild(o); }
  $('#fxSecs').addEventListener('input', () => { $('#fxSecsOut').textContent = $('#fxSecs').value + ' s'; });
  $('#fxMake').addEventListener('click', () => makeEffectAnim(sel.value, { seconds: +$('#fxSecs').value }).catch(e => { console.error(e); toast('Could not make the animation: ' + e.message, 'error'); }));
  $('#fxBack').addEventListener('click', backToStill);
  updateEffectsUI();
}
