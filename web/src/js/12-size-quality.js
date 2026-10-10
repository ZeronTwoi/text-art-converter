/* =====================================================================
   Size & quality: presets + live file-size estimates for every format
   ===================================================================== */
const QUALITY = {
  small:    { name: 'Small',    note: 'smallest files',  exportScale: 0.5, quality: 0.6,  gifColors: 32,  gifFps: 8,  frameStep: 2, videoBitrate: 2,  videoFps: 20 },
  balanced: { name: 'Balanced', note: 'good for sharing', exportScale: 1,   quality: 0.82, gifColors: 128, gifFps: 12, frameStep: 1, videoBitrate: 6,  videoFps: 30 },
  high:     { name: 'High',     note: 'sharper, bigger', exportScale: 2,   quality: 0.92, gifColors: 256, gifFps: 20, frameStep: 1, videoBitrate: 12, videoFps: 30 },
  max:      { name: 'Max',      note: 'best, largest',   exportScale: 3,   quality: 1,    gifColors: 256, gifFps: 30, frameStep: 1, videoBitrate: 25, videoFps: 60 },
};
const QUALITY_KEYS = ['exportScale', 'quality', 'gifColors', 'gifFps', 'frameStep', 'videoBitrate', 'videoFps'];
function currentQuality() {
  for (const [k, q] of Object.entries(QUALITY)) if (QUALITY_KEYS.every(key => Math.abs(S[key] - q[key]) < 1e-6)) return k;
  return 'custom';
}
function applyQuality(k) { const q = QUALITY[k]; if (!q) return; const o = {}; QUALITY_KEYS.forEach(key => { o[key] = q[key]; }); applySettings(o); toast('Quality: ' + q.name); }
function updateQualityButtons() {
  const cur = currentQuality();
  $$('#qualitySeg button').forEach(b => b.classList.toggle('on', b.dataset.q === cur));
  const c = $('#qualityCustom'); if (c) c.hidden = cur !== 'custom';
}
let sizeTimer = 0;
function scheduleSizeEstimate() {
  if (!$('#sizeInfoBox') || (S.exportGoal || 'chat') !== 'save') return;
  if (App.playing) { if (sizeTimer) return; sizeTimer = setTimeout(() => { sizeTimer = 0; estimateSizes(); }, 1500); return; }   // playing: at most every 1.5 s
  clearTimeout(sizeTimer); sizeTimer = setTimeout(() => { sizeTimer = 0; estimateSizes(); }, 450);
}
function setEst(key, text, title) { $$(`[data-est="${key}"] .sz`).forEach(e => { e.textContent = text; if (title) e.parentNode.title = title; }); }
/* settings that change how a result is drawn into a picture (with the result itself and the scale) */
const RENDER_KEYS = ['fontSize', 'charAspect', 'bg', 'bgMode', 'renderStyle', 'dotShape', 'dotSize', 'fontFamily', 'customFont', 'margin',
  'layerOn', 'layerStyle', 'layerX', 'layerY', 'layerSize', 'layerOpacity', 'layerBlend'];
const objIds = new WeakMap(); let objIdNext = 1;
const objId = o => { let k = objIds.get(o); if (!k) { k = objIdNext++; objIds.set(o, k); } return k; };
/* File size of this result in every still format: drawn once, encoded on a worker (or here, as a fallback). */
async function stillSizes(res, scale, W, H, alive) {
  const sizes = {}, c = document.createElement('canvas'), transparent = S.bgMode === 'transparent';
  sizes.bmp = 54 + ((W * 3 + 3) & ~3) * H;
  const fmts = IMG_FORMATS.filter(f => !f.custom), solidJpeg = transparent && fmts.some(f => f.mime === 'image/jpeg');
  const groups = [[null, fmts.filter(f => !(solidJpeg && f.mime === 'image/jpeg'))]];
  if (solidJpeg) groups.push(['solid', fmts.filter(f => f.mime === 'image/jpeg')]);
  for (const [bgMode, list] of groups) {
    if (!list.length) continue;
    renderResult(res, S, c, scale, { bgMode: bgMode || undefined });
    let got = null;
    if (Pool.size()) {
      try { const snap = await createImageBitmap(c); got = await Pool.run('sizes', { img: snap, types: list.map(f => f.mime), quality: S.quality }, [snap]); } catch (e) { got = null; }
      if (!alive()) return null;
    }
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (got && got[i] > 0) { sizes[f.ext] = got[i]; continue; }
      try { sizes[f.ext] = (await canvasToBlob(c, f.mime, S.quality)).size; } catch (e) { sizes[f.ext] = 0; }
      if (!alive()) return null;
      await nextTick();
    }
  }
  return sizes;
}
async function estimateSizes() {
  const token = estimateSizes.token = {}, s = App.src, res = App.res, box = $('#sizeInfoBox');
  if (!s || !res || !box || App.exporting) return;
  const alive = () => estimateSizes.token === token && App.res;
  // dimensions
  const scale = safeScaleQuiet(res, S.exportScale), [W, H] = pictureSize(res.cols, res.rows, S, scale);
  let line = `Picture: <b>${W} × ${H} px</b>`;
  let frames = 1, secs = 0;
  if (s.kind === 'anim' || s.kind === 'video') {
    frames = countFrames(); const [a, b] = trimRange(); secs = b - a;
    line += ` · animation: <b>${frames} frames</b>, ${fmtTime(secs)}`;
  }
  box.innerHTML = line;
  // still pictures: exact sizes from a real encode of this frame (cached: only redone when the picture changes)
  const stillSig = [objId(res), scale, S.quality, ...RENDER_KEYS.map(k => S[k])].join('|');
  if (!estimateSizes.still || estimateSizes.still.sig !== stillSig) {
    const sizes = await stillSizes(res, scale, W, H, alive);
    if (!sizes) return;
    estimateSizes.still = { sig: stillSig, sizes };
  }
  for (const f of IMG_FORMATS) { const z = estimateSizes.still.sizes[f.ext]; setEst(f.ext, z > 0 ? fmtBytes(z) : ''); }
  if (!(s.kind === 'anim' || s.kind === 'video')) return;
  if (s.complete === false) { setEst('gif', '…', 'Shown when the animation has finished loading'); return; }
  // GIF: encode a few sample frames (in parallel) and scale up
  try {
    // sample frames: the first one (stored whole) and, with "only what changes", two pairs of neighbouring frames
    const diff = !!S.gifDiff && S.bgMode !== 'transparent', drawables = [];
    if (s.kind === 'anim') {
      const [a, b] = trimRange(), i0 = frameIndexAt(a), i1 = frameIndexAt(Math.max(a, b - 1e-6)), at = t => s.frames[Math.round(i0 + (i1 - i0) * t)];
      if (diff && i1 > i0) for (const t of [0, 0.35, 0.7]) { const i = Math.min(i1 - 1, Math.round(i0 + (i1 - i0) * t)); drawables.push(s.frames[i].bmp, s.frames[i + 1].bmp); }
      else for (const t of [0, 0.5, 0.95]) drawables.push(at(t).bmp);
    } else { const d = currentDrawable(); if (d) drawables.push(d[0]); }
    const rs = drawables.map(d => convert(d, s.w || d.videoWidth, s.h || d.videoHeight, S));
    const gifSig = [...rs.map(objId), scale, S.gifColors, diff, S.gifDither, ...RENDER_KEYS.map(k => S[k])].join('|');
    if (!estimateSizes.gif || estimateSizes.gif.sig !== gifSig) {
      const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true }), px = [];
      for (const r of rs) { if (!alive()) return; renderResult(r, S, c, scale); px.push(g.getImageData(0, 0, c.width, c.height).data); await nextTick(); }
      const W = c.width, H = c.height, o = { colors: S.gifColors, transparent: S.bgMode === 'transparent', diff, dither: !!S.gifDither, global: null, delay: 10 };
      const paired = diff && s.kind === 'anim' && px.length === 6;
      const frameJobs = paired ? [gifFrameJob(px[0], null, W, H, o), gifFrameJob(px[3], px[2], W, H, o), gifFrameJob(px[5], px[4], W, H, o)] : px.map(p => gifFrameJob(p, null, W, H, o));
      const lens = await Promise.all(frameJobs.map(a => { const local = () => gifJobBytes(a).length; return Pool.size() ? Pool.run('gif', a).then(b => b.length, local) : local(); }));
      if (!alive()) return;
      estimateSizes.gif = paired ? { sig: gifSig, first: lens[0], perFrame: (lens[1] + lens[2]) / 2 } : { sig: gifSig, first: 0, perFrame: lens.reduce((x, y) => x + y, 0) / Math.max(1, lens.length) };
    }
    const est = estimateSizes.gif;
    if (rs.length) setEst('gif', '≈ ' + fmtBytes(est.first ? est.first + est.perFrame * (frames - 1) + 800 : est.perFrame * frames + 800), s.kind === 'video' && diff ? 'Upper estimate from one frame: storing only what changes usually makes it smaller' : 'Estimated from sample frames');
  } catch (e) { console.warn('gif estimate', e); }
  // video: bitrate × length
  const vsecs = s.kind === 'anim' ? secs * Math.max(1, Math.round(S.animRepeat)) : secs;
  const vbytes = vsecs * (S.videoBitrate * 1e6 + (s.kind === 'video' && S.includeAudio ? 128e3 : 0)) / 8;
  for (const f of (FAST_VIDEO_OK ? [{ ext: 'mp4' }, { ext: 'webm' }] : VIDEO_FORMATS)) setEst(f.ext, '≈ ' + fmtBytes(vbytes), 'Estimated from the bitrate; the recorder can come out smaller for simple pictures');
}
/* ---- fit a size limit: lowers colours, frames and size until the export fits (a chat app's upload cap,
   small mailboxes, slow connections). The video bitrate follows the budget directly; the GIF is measured
   with the same sample-frame method as the size estimates above. ---- */
function fitBudgetBytes() {
  const sel = $('#fitLimit'); if (!sel) return 0;
  const v = sel.value === 'custom' ? parseFloat($('#fitMB').value) : parseFloat(sel.value);
  return isFinite(v) && v > 0 ? v * 1048576 : 0;
}
/* bytes of the GIF at the current settings, from sample frames */
async function gifEstimateNow() {
  const s = App.src, res = App.res;
  if (!s || !res || !(s.kind === 'anim' || s.kind === 'video') || s.complete === false) return null;
  const frames = countFrames(), scale = safeScaleQuiet(res, S.exportScale);
  const diff = !!S.gifDiff && S.bgMode !== 'transparent', drawables = [];
  if (s.kind === 'anim') {
    const [a, b] = trimRange(), i0 = frameIndexAt(a), i1 = frameIndexAt(Math.max(a, b - 1e-6));
    if (diff && i1 > i0) for (const t of [0, 0.35, 0.7]) { const i = Math.min(i1 - 1, Math.round(i0 + (i1 - i0) * t)); drawables.push(s.frames[i].bmp, s.frames[i + 1].bmp); }
    else for (const t of [0, 0.5, 0.95]) drawables.push(s.frames[Math.round(i0 + (i1 - i0) * t)].bmp);
  } else { const d = currentDrawable(); if (d) drawables.push(d[0]); }
  if (!drawables.length) return null;
  const rs = drawables.map(d => convert(d, s.w || d.videoWidth, s.h || d.videoHeight, S));
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true }), px = [];
  for (const r of rs) { renderResult(r, S, c, scale); px.push(g.getImageData(0, 0, c.width, c.height).data); await nextTick(); }
  const W = c.width, H = c.height, o = { colors: S.gifColors, transparent: S.bgMode === 'transparent', diff, dither: !!S.gifDither, global: null, delay: 10 };
  const paired = diff && s.kind === 'anim' && px.length === 6;
  const jobsL = paired ? [gifFrameJob(px[0], null, W, H, o), gifFrameJob(px[3], px[2], W, H, o), gifFrameJob(px[5], px[4], W, H, o)] : px.map(p => gifFrameJob(p, null, W, H, o));
  const lens = await Promise.all(jobsL.map(a => { const local = () => gifJobBytes(a).length; return Pool.size() ? Pool.run('gif', a).then(b => b.length, local) : local(); }));
  return paired ? lens[0] + (lens[1] + lens[2]) / 2 * Math.max(0, frames - 1) + 800 : lens.reduce((x, y) => x + y, 0) / lens.length * frames + 800;
}
/* one small quality cut, rotating between colours, frames and size so no single one collapses */
function fitLowerOne(changes, turn) {
  const s = App.src, anim = s && (s.kind === 'anim' || s.kind === 'video');
  const steps = [];
  if (anim && S.gifColors > 16) steps.push(() => {
    const next = S.gifColors > 128 ? 128 : S.gifColors > 96 ? 96 : S.gifColors > 64 ? 64 : S.gifColors > 48 ? 48 : S.gifColors > 32 ? 32 : 16;
    applySettings({ gifColors: next }); changes.set(tr('colours'), String(next));
  });
  if (anim && s.kind === 'anim' && S.frameStep < 4) steps.push(() => { applySettings({ frameStep: S.frameStep + 1 }); changes.set(tr('frames'), 'every ' + S.frameStep + '.'); });
  if (anim && s.kind === 'video' && S.gifFps > 6) steps.push(() => { applySettings({ gifFps: Math.max(6, Math.round(S.gifFps * 0.7)) }); changes.set(tr('smoothness'), S.gifFps + ' fps'); });
  if (S.exportScale > 0.5) steps.push(() => { applySettings({ exportScale: Math.max(0.5, Math.round(S.exportScale * 0.8 * 4) / 4) }); changes.set(tr('size'), S.exportScale + '×'); });
  if (!anim && S.quality > 0.4) steps.push(() => { applySettings({ quality: Math.max(0.4, Math.round((S.quality - 0.12) * 100) / 100) }); changes.set(tr('quality'), String(S.quality)); });
  if (!steps.length) return false;
  steps[turn % steps.length](); return true;
}
async function fitToLimit() {
  const budget = fitBudgetBytes(), s = App.src, res = App.res, note = $('#fitNote');
  if (!budget || !s || !res || App.exporting) return;
  const anim = s.kind === 'anim' || s.kind === 'video';
  note.hidden = false; note.textContent = 'Fitting…';
  const changes = new Map();
  if (anim) {   // the video formats: the bitrate follows the budget directly
    const [a, b] = trimRange(), secs = Math.max(0.1, (b - a) * (s.kind === 'anim' ? Math.max(1, Math.round(S.animRepeat)) : 1));
    const audio = s.kind === 'video' && S.includeAudio ? 128e3 : 0;
    const target = Math.max(0.3, Math.round(Math.min(S.videoBitrate, (budget * 8 / secs - audio) / 1e6 * 0.92) * 10) / 10);
    if (target < S.videoBitrate) { applySettings({ videoBitrate: target }); changes.set(tr('video bitrate'), target + ' Mbit/s'); }
  }
  let est = null;
  try {
    for (let i = 0; i < 14; i++) {
      if (anim) est = await gifEstimateNow();
      else { const scale = safeScaleQuiet(res, S.exportScale), [W, H] = pictureSize(res.cols, res.rows, S, scale); const sz = await stillSizes(res, scale, W, H, () => true); est = sz && sz.png; }
      if (est == null || est <= budget) break;
      if (!fitLowerOne(changes, i)) break;
    }
  } catch (e) { console.warn('fit', e); }
  scheduleSizeEstimate();
  const what = [...changes].map(([k, v]) => k + ' ' + v).join(', ');
  note.textContent = est == null ? 'Could not estimate the size here.'
    : (est <= budget ? `Fits: now ≈ ${fmtBytes(est)} of ${fmtBytes(budget)}` : `Still ≈ ${fmtBytes(est)} — fewer characters (Adjust → Width) or a shorter trim range would help`)
      + (what ? ' (' + what + ')' : anim ? ' (nothing needed changing)' : '');
  fitPreviewDraw();
}
/* a small preview with the GIF's palette applied: a general idea of how the compressed file will look */
function fitPreviewDraw() {
  const cv = $('#fitPreview'), res = App.res, s = App.src; if (!cv || !res) return;
  const scale = Math.min(0.75, 480 / Math.max(1, pictureSize(res.cols, res.rows, S, 1)[0]));
  renderResult(res, S, cv, scale);
  if (s && (s.kind === 'anim' || s.kind === 'video')) {
    const g = cv.getContext('2d'), img = g.getImageData(0, 0, cv.width, cv.height);
    const q = quantizeRGBA(img.data, S.gifColors, false, S.gifDither ? cv.width : 0), d = img.data;
    for (let i = 0, o = 0; o < d.length; i++, o += 4) { const pi = q.ind[i] * 3; d[o] = q.pal[pi]; d[o + 1] = q.pal[pi + 1]; d[o + 2] = q.pal[pi + 2]; d[o + 3] = 255; }
    g.putImageData(img, 0, 0);
  }
  cv.hidden = false;
}
function safeScaleQuiet(res, scale) {
  let s = scale;
  for (let i = 0; i < 40; i++) { const [w, h] = pictureSize(res.cols, res.rows, S, s); if (w <= 16000 && h <= 16000 && w * h <= 120e6) break; s *= 0.85; }
  return s;
}

function openTextDialog(text) { $('#textIn').value = text || ''; $('#textDialog').showModal(); $('#textIn').focus(); }

