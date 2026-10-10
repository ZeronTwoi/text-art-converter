/* =====================================================================
   Sources & playback
   ===================================================================== */
const App = {
  src: null, res: null, playing: false, time: 0, lastNow: performance.now(), speed: 1, loop: true,
  tin: null, tout: null, dirty: true, exporting: false, cancel: false, view: 'out', zoom: 0,
  lastIdx: -1, lastVT: -1, renderMs: 0, muted: false, recorder: null, seeking: false,
};
const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv', 'ogg', '3gp', 'avi', 'mpeg', 'mpg', 'ts']);
const MIME_BY_EXT = { gif: 'image/gif', png: 'image/png', apng: 'image/apng', webp: 'image/webp', avif: 'image/avif', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', pjpeg: 'image/jpeg', pjp: 'image/jpeg', bmp: 'image/bmp', ico: 'image/x-icon', cur: 'image/x-icon', svg: 'image/svg+xml', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg', ogg: 'video/ogg', '3gp': 'video/3gpp', txt: 'text/plain' };

function duration() {
  const s = App.src; if (!s) return 0;
  if (s.kind === 'anim') return s.duration;
  if (s.kind === 'video') return isFinite(s.video.duration) ? s.video.duration : 0;
  return 0;
}
function trimRange() {
  const d = duration(); let a = App.tin == null ? 0 : App.tin, b = App.tout == null ? d : App.tout;
  a = clamp(a, 0, d); b = clamp(b, 0, d);
  if (b - a < 1e-3) { a = 0; b = d; }
  return [a, b];
}
function curTime() { const s = App.src; if (!s) return 0; if (s.kind === 'anim') return App.time; if (s.video) return s.video.currentTime; return 0; }
function frameIndexAt(t) { return frameIndexIn(App.src, t); }
function frameIndexIn(src, t) {
  const f = src.frames; let lo = 0, hi = f.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f[mid].t0 <= t + 1e-9) lo = mid; else hi = mid - 1; }
  return lo;
}
function currentDrawable() {
  const s = App.src; if (!s) return null;
  switch (s.kind) {
    case 'image': return [s.bmp, s.w, s.h];
    case 'anim': { const b = animBitmap(s, frameIndexAt(App.time)); return b ? [b, s.w, s.h] : null; }
    case 'video': case 'webcam': {
      const v = s.video; if (v.readyState < 2 || !v.videoWidth) return null;
      return [v, v.videoWidth, v.videoHeight];
    }
  }
  return null;
}
function makeAnim(frames, w, h) {
  const s = { kind: 'anim', frames, w, h, duration: 0 };
  retime(s);
  for (const f of frames) if (f.bmp) srcOwner.set(f.bmp, s);
  return s;
}
function retime(s) { let t = 0; for (const f of s.frames) { f.t0 = t; t += f.delay / 1000; } s.duration = t; }
/* which source a drawable (bitmap of a frame, video) belongs to */
const srcOwner = new WeakMap();
/* An animation that is shown and played while its frames are still being decoded. decode(i) → { bmp, delay } is called
   for i = 0, 1, … in order; frames[i].bmp is null until frame i has arrived. Resolves when the first frame is there;
   s.ready resolves when all are (s.complete). Decoded pixels become bitmaps at once (only one RGBA copy at a time). */
async function progressiveAnim(delays, w, h, decode) {
  const s = makeAnim(delays.map(d => ({ bmp: null, delay: d })), w, h);
  s.loaded = 0; s.complete = false;
  let first; const firstFrame = new Promise((res, rej) => { first = { res, rej }; });
  s.ready = (async () => {
    let i = 0, lastYield = performance.now();
    try {
      for (; i < s.frames.length; i++) {
        if (s.disposed) return;
        const fr = await decode(i);
        if (!fr) break;
        fr.bmp = await rasterBitmap(fr.bmp);   // every frame the same kind of bitmap, however it was decoded
        if (s.disposed) { try { fr.bmp.close(); } catch (e) {} return; }
        s.frames[i].bmp = fr.bmp; srcOwner.set(fr.bmp, s);
        if (fr.delay && fr.delay !== s.frames[i].delay) { s.frames[i].delay = fr.delay; retime(s); }
        s.loaded = i + 1;
        if (i === 0) first.res();
        else onAnimFrame(s, i);
        if (performance.now() - lastYield > 12) { await nextTick(); lastYield = performance.now(); }
      }
    } catch (e) { console.warn('decoding stopped at frame', i, e); if (i === 0) { first.rej(e); return; } }
    if (!s.loaded) { first.rej(new Error('no frames')); return; }
    if (s.loaded < s.frames.length) { s.frames.length = s.loaded; retime(s); }   // a broken file: keep what decoded
    s.complete = true;
    onAnimFrame(s, -1);
  })();
  await firstFrame;
  return s;
}
/* a frame of the open, still loading animation arrived (i = -1: all arrived) */
function onAnimFrame(s, i) {
  if (App.src !== s) return;
  if (i < 0) { updateSrcInfo(); buildFilmstrip(); scheduleSizeEstimate(); App.dirty = true; if (s.autoplay && !App.playing) setPlaying(true); s.autoplay = false; return; }
  if (frameIndexAt(App.time) === i) App.dirty = true;
  const it = film.items.find(x => x.idx === i);
  if (it && it.c) it.c.getContext('2d').drawImage(s.frames[i].bmp, 0, 0, it.c.width, it.c.height);
  if (i % 25 === 0) updateSrcInfo();
}
/* A decoded picture as a plain canvas-made bitmap. The browser resamples a bitmap decoded straight from a file
   differently from the same pixels drawn on a canvas, so without this one picture could convert differently
   depending on how it was opened (file, paste, demo, project). One copy at load time, nothing per frame. */
async function rasterBitmap(src, w = src.displayWidth || src.width, h = src.displayHeight || src.height) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  const b = await createImageBitmap(c);
  if (src.close) src.close();
  c.width = c.height = 0;
  return b;
}
/* the newest decoded frame at or before frame i */
function animBitmap(s, i) { for (let k = Math.min(i, s.frames.length - 1); k >= 0; k--) if (s.frames[k].bmp) return s.frames[k].bmp; return null; }

async function framesViaImageDecoder(buf, type) {
  if (!('ImageDecoder' in window)) return null;
  try {
    if (!(await ImageDecoder.isTypeSupported(type))) return null;
    const dec = new ImageDecoder({ data: buf, type });
    await dec.tracks.ready; try { await dec.completed; } catch (e) {}
    const tr = dec.tracks.selectedTrack;
    if (!tr || tr.frameCount < 2) { dec.close(); return null; }
    const n = Math.min(tr.frameCount, 3000), decode = async i => {
      const { image } = await dec.decode({ frameIndex: i });
      const fr = { bmp: await createImageBitmap(image), delay: image.duration ? Math.max(20, image.duration / 1000) : 100 };
      image.close();
      if (i === n - 1) dec.close();
      return fr;
    };
    const f0 = await decode(0), w = f0.bmp.width, h = f0.bmp.height;   // the others are timed like the first until they arrive
    return await progressiveAnim(new Array(n).fill(f0.delay), w, h, i => i ? decode(i) : f0);
  } catch (e) { console.warn('ImageDecoder failed:', e); return null; }
}
/* fmt = format sniffed from the file's bytes (not its name) */
async function loadImageFile(file, fmt, ext) {
  const buf = await file.arrayBuffer(), d = new Uint8Array(buf);
  if (fmt === 'gif') {
    try {
      const delays = gifDelays(buf), g = gifDecoder(buf);
      if (delays.length < 2) { const f = g.next(); if (!f) throw new Error('GIF has no frames'); return { kind: 'image', bmp: await rasterBitmap(await createImageBitmap(f.data)), w: g.width, h: g.height, stillGif: true }; }
      const wd = gifWorkerDecoder(buf, g.width, g.height);   // decoding on a background thread; here as a fallback
      const anim = await progressiveAnim(delays, g.width, g.height, wd ? i => wd.decode(i) : async () => { const f = g.next(); return f && { bmp: await createImageBitmap(f.data), delay: f.delay }; });
      if (wd) anim.ready.then(() => wd.stop());
      return anim;
    } catch (e) { console.warn('GIF decoder fallback:', e); const a = await framesViaImageDecoder(buf, 'image/gif'); if (a) return a; }
  } else if (fmt === 'png' && isAPNG(d)) {
    const a = await framesViaImageDecoder(buf, 'image/png'); if (a) return a;
    try { const p = parseAPNG(d); return await progressiveAnim(p.frames.map(f => f.delay), p.width, p.height, frameCompositor(p)); } catch (e) { console.warn('APNG fallback:', e); }
  } else if (fmt === 'webp' && isAnimatedWebP(d)) {
    const a = await framesViaImageDecoder(buf, 'image/webp'); if (a) return a;
    try { const p = parseAnimWebP(d); return await progressiveAnim(p.frames.map(f => f.delay), p.width, p.height, frameCompositor(p)); } catch (e) { console.warn('animated WEBP fallback:', e); }
  } else if (fmt === 'avif') {
    const a = await framesViaImageDecoder(buf, 'image/avif'); if (a) return a;
  }
  const blob = new Blob([buf], { type: SNIFF_MIME[fmt] || file.type || '' });
  if (fmt !== 'svg') {
    try { const bmp = await rasterBitmap(await createImageBitmap(blob)); return { kind: 'image', bmp, w: bmp.width, h: bmp.height }; } catch (e) { /* try <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
    return { kind: 'image', bmp: await createImageBitmap(c), w, h };
  } catch (e) {
    throw new Error(`this browser can't decode ${ext ? '.' + ext : 'this'} images${/heic|heif|tiff?/.test(ext) ? ' (convert it to JPG or PNG first)' : ''}`);
  } finally { URL.revokeObjectURL(url); }
}
async function loadVideoFile(file) {
  const v = document.createElement('video');
  v.preload = 'auto'; v.playsInline = true; v.muted = App.muted; v.crossOrigin = 'anonymous';
  const url = URL.createObjectURL(file); v.src = url;
  $('#videoHost').appendChild(v);
  await new Promise((res, rej) => {
    v.onloadeddata = () => res();
    v.onerror = () => rej(new Error("this browser can't play this video format/codec (try MP4 H.264 or WEBM)"));
  });
  if (!isFinite(v.duration)) {   // MediaRecorder WEBMs report Infinity until scanned
    await new Promise(res => { v.ondurationchange = () => { if (isFinite(v.duration)) res(); }; v.currentTime = 1e9; setTimeout(res, 3000); });
    v.ondurationchange = null; v.currentTime = 0;
  }
  return { kind: 'video', video: v, url, w: v.videoWidth, h: v.videoHeight };
}
/* how: 'pasted' when it came from the clipboard (browsers copy only a still frame of GIFs) */
async function openFile(file, how) {
  if (!file) return;
  if (App.exporting) return toast('Wait for the export to finish first');
  const name = file.name || 'pasted', ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer()), fmt = sniffFormat(head);
  if (ext === 'textlook') { await openLookFile(file); return; }
  if (ext === 'textart' || isZipHead(head)) { await openProject(file); return; }
  const type = SNIFF_MIME[fmt] || file.type || MIME_BY_EXT[ext] || '';
  if (!fmt && (type.startsWith('text/') || ['txt', 'ans', 'nfo', 'asc', 'diz'].includes(ext))) {
    const { text, ansi } = await readTextArt(file);
    openTextArt(ansi ? null : text, name, ansi, text);
    return;
  }
  showProgress('Opening ' + name, true);
  try {
    let src;
    if (fmt === 'video' || (!fmt && (type.startsWith('video/') || VIDEO_EXT.has(ext)))) src = await loadVideoFile(file);
    else src = await loadImageFile(file, fmt, ext);
    src.name = name; src.mime = type; src.bytes = file.size; src.file = file;
    setSource(src);
    // explain anything surprising about what was loaded
    const realExt = { gif: 'GIF', png: 'PNG', webp: 'WEBP', avif: 'AVIF', jpeg: 'JPG', video: 'video' }[fmt];
    const named = { gif: 'gif', png: 'png', apng: 'png', webp: 'webp', jpg: 'jpeg', jpeg: 'jpeg', avif: 'avif' }[ext];
    if (src.kind === 'anim') toast(`Animation loaded: ${src.frames.length} frames, ${fmtTime(src.duration)}${fmt && named && named !== fmt ? ` (the file is really a ${realExt})` : ''}`);
    else if (src.kind === 'video' && named) toast(`This "${ext}" file is really a video. Loaded it with the video player`);
    else if (how === 'pasted' && src.kind === 'image') toast('Pasted as a still picture. Browsers copy only one frame of a GIF; to keep the animation, save the GIF and open or drop the file', 'error');
    else if (src.stillGif) toast('This GIF has only one frame, so there is nothing to play');
  } catch (e) {
    console.error(e); toast('Could not open file: ' + e.message, 'error');
  } finally { hideProgress(); }
}
/* Fetch the original file behind a pasted/dropped web image, so GIFs keep their animation. */
async function openFromUrl(url) {
  const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const name = (decodeURIComponent(new URL(url).pathname.split('/').pop() || 'web-image') || 'web-image').slice(0, 80);
    await openFile(new File([blob], name, { type: blob.type }));
    return true;
  } catch (e) { console.warn('Could not fetch', url, e); return false; } finally { clearTimeout(to); }
}
function imageUrlFrom(dt) {
  const html = dt.getData('text/html') || '', m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  const cands = [m && m[1], (dt.getData('text/uri-list') || '').split('\n').find(l => l && !l.startsWith('#')), dt.getData('text/plain')];
  return cands.map(u => (u || '').trim()).find(u => /^https?:\/\/\S+$/i.test(u)) || null;
}
function setTextSource(text, name, ansi) {
  if (!text || !text.trim()) return toast('No text to render');
  const r = textResultRaw(text, S, ansi);
  setSource({ kind: 'text', text, ansi: ansi || null, name: name || 'text-art.txt', w: r.cols, h: r.rows });
}
function disposeSource(s) {
  clearEngineCaches();
  if (!s) return;
  s.disposed = true;   // stops a background decode
  if (App.recorder) { try { App.recorder.stop(); } catch (e) {} }
  try { if (s.bmp && s.bmp.close) s.bmp.close(); } catch (e) {}
  if (s.frames) for (const f of s.frames) { try { f.bmp.close && f.bmp.close(); } catch (e) {} }
  if (s.video) { try { s.video.pause(); } catch (e) {} s.video.removeAttribute('src'); s.video.srcObject = null; s.video.remove(); }
  if (s.url) URL.revokeObjectURL(s.url);
  if (s.stream) s.stream.getTracks().forEach(t => t.stop());
  if (s.audio) { try { s.audio.ctx.close(); } catch (e) {} }
  if (s.effect && s.effect.still) { try { s.effect.still.close(); } catch (e) {} }
}
function setSource(s) {
  endPeek(true); if (Crop.on) setCropMode(false); editsClear(); if (Edit.on) setEditMode(false);
  disposeSource(App.src); Prefetch.clear(); maskClear(); previewCacheClear(); if (Mask.on) setMaskMode(false);
  App.src = s; App.time = 0; App.tin = App.tout = null; App.lastIdx = -1; App.lastVT = -1; App.playing = false;
  if (s.bmp) srcOwner.set(s.bmp, s); if (s.video) srcOwner.set(s.video, s);
  if (s.video) {
    const v = s.video;
    v.muted = s.kind === 'webcam' ? true : App.muted;
    v.addEventListener('play', () => { if (App.src === s) App.playing = true; });
    v.addEventListener('pause', () => { if (App.src === s) App.playing = false; });
    v.addEventListener('seeked', () => { if (App.src === s) App.dirty = true; });
    v.addEventListener('loadeddata', () => { if (App.src === s) { App.dirty = true; scheduleLooks(); } });   // the look cards show the first frame as soon as it can be drawn
    v.addEventListener('ended', () => {
      if (App.src !== s || App.exporting) return;
      if (App.loop) { v.currentTime = trimRange()[0]; v.play().catch(() => {}); }
    });
  }
  document.body.dataset.kind = s.kind;
  $('#empty').hidden = true; $('#views').hidden = false;
  $('#player').hidden = !(s.kind === 'anim' || s.kind === 'video' || s.kind === 'webcam');
  $('#pMute').hidden = s.kind !== 'video';
  updateMuteBtn();
  updateSrcInfo(); buildExportPanel(); updateTrimBar(); syncControls();
  App.dirty = true;
  if (s.kind === 'anim' && s.complete === false) s.autoplay = true;   // still loading: plays when all frames are there
  else if (s.kind === 'anim' || s.kind === 'webcam') setPlaying(true);
  if (s.kind !== 'image' && s.kind !== 'text') setTimeout(() => Pool.size(), 0);   // start the workers before playback needs them
  App.look = null; markLooks(); scheduleLooks(); buildFilmstrip(); setStep(2);
  updateEffectsUI(); updateLayerUI(); $('#resumeBox').hidden = true; scheduleSessionSave();
}
function updateSrcInfo() {
  const s = App.src; if (!s) { $('#srcInfo').textContent = 'No file loaded'; return; }
  const kind = { image: 'Image', anim: 'Animation', video: 'Video', webcam: 'Webcam (live)', text: 'Text art' }[s.kind];
  const bits = [s.name || '', kind];
  if (s.kind === 'text') bits.push(`${s.w}×${s.h} chars`);
  else bits.push(`${s.w}×${s.h}px`);
  if (s.kind === 'anim') bits.push(s.complete === false ? `loading ${s.loaded} / ${s.frames.length} frames` : `${s.frames.length} frames`, fmtTime(s.duration));
  if (s.kind === 'video') bits.push(fmtTime(duration()));
  if (s.bytes) bits.push(fmtBytes(s.bytes));
  $('#srcInfo').textContent = bits.filter(Boolean).join(' · ');
  $('#srcInfo').title = $('#srcInfo').textContent;
}

function setPlaying(p) {
  const s = App.src; if (!s) return;
  s.autoplay = false;
  if (s.kind === 'anim') {
    const [a, b] = trimRange();
    if (p && (App.time >= b - 1e-3 || App.time < a)) App.time = S.playOrder === 'reverse' ? Math.max(a, b - 1e-6) : a;
    App.playing = p; App.dir = 1;
  } else if (s.kind === 'video') {
    const v = s.video;
    if (p) {
      const [a, b] = trimRange();
      if (v.currentTime >= b - 0.02 || v.currentTime < a - 0.001) v.currentTime = a;
      v.playbackRate = App.speed * (S.playSpeed || 1); v.play().catch(e => toast('Playback failed: ' + e.message, 'error'));
    } else v.pause();
  } else if (s.kind === 'webcam') {
    if (p) s.video.play().catch(() => {}); else s.video.pause();
    App.playing = p;
  }
}
const togglePlay = () => setPlaying(!App.playing);
function seekTo(t) {
  const s = App.src; if (!s) return;
  const d = duration(); t = clamp(t, 0, Math.max(0, d - 1e-4));
  if (s.kind === 'anim') App.time = t;
  else if (s.kind === 'video') s.video.currentTime = t;
  App.dirty = true;
}
function stepFrame(dir) {
  const s = App.src; if (!s) return;
  setPlaying(false);
  if (s.kind === 'anim') { const i = clamp(frameIndexAt(App.time) + dir, 0, s.frames.length - 1); App.time = s.frames[i].t0; }
  else if (s.kind === 'video') seekTo(s.video.currentTime + dir / 30);
  App.dirty = true;
}
function stopPlayback() { setPlaying(false); seekTo(trimRange()[0]); }
function setIn() { if (!duration()) return; App.tin = curTime(); if (App.tout != null && App.tout <= App.tin) App.tout = null; updateTrimBar(); toast('Trim start ' + fmtTime(App.tin)); }
function setOut() { if (!duration()) return; App.tout = curTime(); if (App.tin != null && App.tin >= App.tout) App.tin = null; updateTrimBar(); toast('Trim end ' + fmtTime(App.tout)); }
function clearTrim() { App.tin = App.tout = null; updateTrimBar(); }
function updateTrimBar() {
  scheduleSessionSave();
  const bar = $('#trimBar'), d = duration();
  if (!d || (App.tin == null && App.tout == null)) { bar.hidden = true; return; }
  const [a, b] = trimRange();
  bar.hidden = false; bar.style.left = (a / d * 100) + '%'; bar.style.width = ((b - a) / d * 100) + '%';
}
function updateMuteBtn() { $('#pMute').textContent = App.muted ? 'Muted' : 'Sound on'; }

const uiCache = {};
function setText(id, v) { if (uiCache[id] !== v) { uiCache[id] = v; $('#' + id).textContent = v; } }
function updatePlayerUI() {
  const s = App.src; if (!s) return;
  setText('pPlay', App.playing ? '❚❚' : '▶');
  if (!(s.kind === 'anim' || s.kind === 'video')) return;
  const d = duration(), t = curTime();
  if (!App.seeking) { const v = d ? Math.round(t / d * 10000) : 0; if (uiCache.seek !== v) { uiCache.seek = v; $('#seek').value = v; } }
  setText('pTime', fmtTime(t) + ' / ' + fmtTime(d));
  setText('pFrame', s.kind === 'anim' ? `Frame ${frameIndexAt(t) + 1} of ${s.frames.length} · ${Math.round(s.frames[frameIndexAt(t)].delay)} ms` : '');
  updateFilmstrip();
}

/* ---- main loop ---- */
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.25, (now - App.lastNow) / 1000); App.lastNow = now;
  const s = App.src;
  if (!s || App.exporting) return;
  if (s.kind === 'anim') {
    if (App.playing) {
      const [a, b] = trimRange();
      const step = dt * App.speed * (S.playSpeed || 1), order = S.playOrder;
      if (order === 'reverse' || (order === 'boomerang' && App.dir < 0)) {   // backwards (the saved file plays like this too)
        App.time -= step;
        if (App.time < a) {
          if (order === 'boomerang') { App.time = Math.min(b - 1e-6, a + (a - App.time)); App.dir = 1; if (!App.loop) { App.time = a; App.playing = false; } }
          else if (App.loop) App.time = b - a > 0 ? b - 1e-6 - ((a - App.time) % (b - a)) : a;
          else { App.time = a; App.playing = false; }
        }
      } else App.time += step;
      if (App.time >= b && order === 'boomerang') { App.time = Math.max(a, b - 1e-6 - (App.time - b)); App.dir = -1; }
      if (App.time >= b) {
        if (App.loop) App.time = b - a > 0 ? a + ((App.time - a) % (b - a)) : a;
        else { App.time = Math.max(a, b - 1e-6); App.playing = false; }
      }
      if (App.time < a) App.time = a;
      if (s.complete === false && s.loaded < s.frames.length && App.time >= s.frames[s.loaded].t0) App.time = a < s.frames[s.loaded].t0 ? a : 0;   // still loading: loop over the frames that are there
    }
    const idx = frameIndexAt(App.time);
    if (idx !== App.lastIdx) { App.lastIdx = idx; App.dirty = true; }
  } else if (s.kind === 'video') {
    const v = s.video;
    if (App.playing) {
      const [a, b] = trimRange();
      if (v.currentTime >= b - 0.0005 && b < duration() - 0.01) { if (App.loop) v.currentTime = a; else v.pause(); }
    }
    if (v.currentTime !== App.lastVT) { App.lastVT = v.currentTime; App.dirty = true; }
  } else if (s.kind === 'webcam') {
    if (App.playing) App.dirty = true;
  }
  maskFlush();
  if (Live.active()) { if (App.dirty && Live.inflight < Live.max) { App.dirty = false; Live.start(); } }
  else if (App.dirty) { App.dirty = false; renderNow(); }
  if (s.kind === 'anim' && App.playing) Prefetch.run();
  updatePlayerUI();
  liveLooksTick(now);
}
/* the settings the view shows: yours, or a look you are previewing (pointer resting on a look card) */
const viewS = () => App.peek || settingsAt(curTime());
function computeCurrent() {
  const s = App.src, St = viewS();
  if (s.kind === 'text') return textResult(s.text, St, s.ansi);
  const d = currentDrawable(); if (!d) return null;
  if (s.kind === 'anim' && Prefetch.pending(d[0], d[1], d[2])) return null;   // a worker is converting this frame: keep the last one
  return convert(d[0], d[1], d[2], St);
}
/* Playing video / webcam: this thread resamples the newest frame and a worker does the rest while the next frame
   is drawn (two in flight); results are shown in order, older ones are dropped. Paused frames convert directly. */
const Live = {
  inflight: 0, max: 2, seq: 0, shown: 0, fails: 0,
  active() { const s = App.src; return !!s && (s.kind === 'video' || s.kind === 'webcam') && App.playing && !App.exporting && this.fails < 3 && Pool.size() > 0; },
  start() {
    const s = App.src, d = currentDrawable(); if (!d) return;
    const St = Object.assign({}, viewS()), id = ++this.seq, t0 = performance.now();
    let pre;
    try { pre = convertInputs(d[0], d[1], d[2], St); } catch (e) { console.error(e); return; }
    this.inflight++;
    Pool.run('convertPre', { pre, sw: d[1], sh: d[2], St }).then(res => {
      if (App.src !== s || App.exporting) return;
      if (!this.active()) { App.dirty = true; return; }   // paused meanwhile: show the exact paused frame instead
      if (id < this.shown) return;
      this.shown = id; showResult(withOverlay(res, St), t0);
    }, () => { this.fails++; App.dirty = true; }).finally(() => { this.inflight--; });
  },
};
/* Animation playback: the next frames are converted on workers ahead of time (one dispatch per display frame,
   so this thread stays free), and playing then just shows memoised results. */
const Prefetch = {
  inflight: new Set(), fails: 0,
  pending(src, sw, sh) { if (!this.inflight.size) return false; const k = memoKey(src, sw, sh, viewS()); return !!k && this.inflight.has(k) && !resultCache.m.has(k); },
  clear() { this.inflight.clear(); this.fails = 0; },
  run() {
    const s = App.src, limit = Pool.size();
    if (!s || s.kind !== 'anim' || App.exporting || !limit || this.fails > 3 || this.inflight.size >= limit) return;
    const [a, b] = trimRange(), i0 = frameIndexAt(a), i1 = frameIndexAt(Math.max(a, b - 1e-6)), span = i1 - i0 + 1;
    const cur = frameIndexAt(App.time), ramps = rampsActive(s), sig0 = ramps ? null : convertSig(S);
    for (let k = 1; k < Math.min(span, limit * 3); k++) {
      const i = i0 + ((cur - i0 + k) % span + span) % span, bmp = s.frames[i].bmp; if (!bmp) continue;
      const St = ramps ? settingsAt(s.frames[i].t0) : S, key = memoKey(bmp, s.w, s.h, St, sig0 || convertSig(St));
      if (!key || this.inflight.has(key) || resultCache.m.has(key)) continue;
      this.inflight.add(key);
      convertOnWorker(bmp, s.w, s.h, St).then(r => { if (App.src === s) resultCache.set(key, r, resultBytes(r)); }, () => { this.fails++; })
        .finally(() => {
          if (!this.inflight.delete(key) || App.src !== s) return;
          const d = currentDrawable();
          if (d && memoKey(d[0], d[1], d[2], viewS()) === key) App.dirty = true;   // the frame on screen just arrived
        });
      return;
    }
  },
};
function renderNow() {
  if (!App.src) return;
  const t0 = performance.now();
  let res;
  try { res = computeCurrent(); } catch (e) { console.error(e); toast('Render error: ' + e.message, 'error'); return; }
  if (res) showResult(res, t0);
}
function showResult(res, t0) {
  const out = $('#outCanvas'), peek = !!App.peek, St = viewS();
  // previewing a look (pointer on its card): every view shows it and keeps playing, but your result
  // (exports, sharing, size estimates) stays yours
  if (!peek) {
    App.res = res;
    const label = `The text art: ${res.cols} × ${res.rows} characters`; if (out._label !== label) { out._label = label; out.setAttribute('aria-label', label); }
    if (Edit.on || Edits.cells.size) updateEditUI();
    scheduleHistogram();
  }
  drawPreview(res, St, out);
  if (App.view === 'src' || App.view === 'split' || App.view === 'wipe') drawSourceView();
  if (App.view === 'text') updateRawText(res, St);
  if (!peek) {
    scheduleShareUI();
    if (App.view === 'platform') updatePlatformView();
    scheduleSizeEstimate();
  }
  App.renderMs = performance.now() - t0;
  setText('stats', peek ? `Preview of a look: ${res.cols}×${res.rows} characters · click the card to apply it`
    : `${res.cols}×${res.rows} characters · ${out.width}×${out.height}px · ${App.renderMs.toFixed(1)} ms/frame`);
  setText('sizeInfo', `${res.cols} × ${res.rows} characters → ${out.width} × ${out.height}px image`);
  applyZoom();
}
function drawSourceView() {
  const c = $('#srcCanvas'), out = $('#outCanvas');
  const d = App.src && App.src.kind !== 'text' ? currentDrawable() : null;
  if (!d) { c.width = c.height = 1; return; }
  if (Crop.on) return drawCropView(c, d);
  if (App.view === 'wipe') return drawWipeSource(c, out, d);
  const [, , mx, my] = pictureSize(0, 0, viewS(), 1), ow = Math.max(1, out.width - 2 * mx), oh = Math.max(1, out.height - 2 * my);
  const k = Math.min(1, 1600 / ow);
  const W = Math.max(1, Math.round(ow * k)), H = Math.max(1, Math.round(oh * k));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  drawTransformed(g, d[0], d[1], d[2], W, H, S); drawLayer(g, d[1], d[2], W, H, S);
  if (Mask.canvas && Mask.src === App.src && (Mask.ver || Mask.on)) {   // the painted mask on top: red = hide, green = keep
    const t = drawSourceView.t || (drawSourceView.t = document.createElement('canvas'));
    if (t.width !== W || t.height !== H) { t.width = W; t.height = H; }
    drawTransformed(t.getContext('2d'), Mask.canvas, Mask.canvas.width, Mask.canvas.height, W, H, S);
    g.save(); g.globalAlpha = 0.5; g.drawImage(t, 0, 0); g.restore();
  }
}
/* a point of a drawTransformed view (W×H) → the matching point of the source (sw×sh) */
function viewToSource(px, py, W, H, sw, sh, S) {
  const [ix, iy, iw, ih] = cropRect(sw, sh, S), rot = normRot(S.rotate), swap = rot === 90 || rot === 270, dw = swap ? H : W, dh = swap ? W : H;
  let x = px - W / 2, y = py - H / 2;
  if (S.flipH) x = -x; if (S.flipV) y = -y;
  const a = -rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), lx = x * cs - y * sn, ly = x * sn + y * cs;
  return [ix + (lx + dw / 2) / dw * iw, iy + (ly + dh / 2) / dh * ih];
}
/* paint on the mask at a point of the source view; from = the previous point of the stroke */
function maskStroke(px, py, from) {
  const s = App.src, c = $('#srcCanvas'); if (!s || s.kind === 'text') return;
  const m = maskEnsure(), g = m.canvas.getContext('2d'), kx = m.canvas.width / s.w, ky = m.canvas.height / s.h;
  const [ix, iy, iw, ih] = cropRect(s.w, s.h, S), r = Math.max(1, Mask.size / 100 * Math.max(iw * kx, ih * ky));
  const to = viewToSource(px, py, c.width, c.height, s.w, s.h, S).map((v, i) => v * (i ? ky : kx));
  const start = from || to, dist = Math.hypot(to[0] - start[0], to[1] - start[1]), steps = Math.max(1, Math.ceil(dist / (r / 3)));
  g.save();
  g.globalCompositeOperation = Mask.brush === 'erase' ? 'destination-out' : 'source-over';
  const col = Mask.brush === 'keep' ? '0,255,0' : '255,0,0';
  for (let k = from ? 1 : 0; k <= steps; k++) {
    const x = start[0] + (to[0] - start[0]) * k / steps, y = start[1] + (to[1] - start[1]) * k / steps;
    const gr = g.createRadialGradient(x, y, r * (Mask.hard ? 0.94 : 0.55), x, y, r);
    gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  g.restore();
  Mask.pending = true;   // the next display frame takes the new mask
  return to;
}
function setMaskMode(on) {
  Mask.on = on && !!App.src && App.src.kind !== 'text';
  if (Mask.on) $('#maskPaint').closest('details').open = true;
  if (Mask.on && Crop.on) setCropMode(false);
  $('#maskPaint').classList.toggle('primary', Mask.on);
  $('#maskPaint').textContent = Mask.on ? '✓ Painting (drag on the original)' : '🖌 Paint on the picture';
  $('#views').classList.toggle('painting', Mask.on);
  if (Mask.on) { if (App.view !== 'split' && App.view !== 'src') setView('split'); maskEnsure(); }
  App.dirty = true;
}
function updateMaskUI() {
  $$('#maskBrushes button').forEach(b => { b.classList.toggle('on', b.dataset.brush === Mask.brush); b.setAttribute('aria-pressed', b.dataset.brush === Mask.brush); });
  $$('#maskHardness button').forEach(b => { const on = (b.dataset.hard === '1') === !!Mask.hard; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $('#maskSizeOut').textContent = Mask.size + '%';
  $('#maskUndo').disabled = !MaskHist.undo.length; $('#maskRedo').disabled = !MaskHist.redo.length;
}
function updateRawText(res = App.res, St = S) {
  const pre = $('#rawText'); if (!res) return;
  pre.style.cssText = preStyle(St) + `background:${St.bgMode === 'transparent' ? 'transparent' : St.bg};color:${St.fg}`;
  if (!res.uniform && res.cols * res.rows <= 80000) pre.innerHTML = resultHTMLInner(res);
  else pre.textContent = resultText(res);
}
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
function applyZoom() {
  const views = $('#views'), out = $('#outCanvas'), src = $('#srcCanvas');
  views.className = 'views view-' + App.view + (App.zoom ? ' zoomed' : '') + (Mask.on ? ' painting' : '') + (Crop.on ? ' cropping' : '') + (typeof Edit !== 'undefined' && Edit.on ? ' editing' : '');
  if (App.zoom) {
    const w = Math.round(out.width * App.zoom) + 'px', h = Math.round(out.height * App.zoom) + 'px';
    out.style.width = src.style.width = w; out.style.height = src.style.height = h;
    $('#rawText').style.zoom = App.zoom;
  } else {
    out.style.width = out.style.height = src.style.width = src.style.height = '';
    $('#rawText').style.zoom = '';
  }
  out.style.imageRendering = App.zoom >= 2 ? 'pixelated' : 'auto';
  setText('zoomLabel', App.zoom ? Math.round(App.zoom * 100) + '%' : 'Fit');
  placeWipe(); if (typeof placeEditOverlay === 'function') placeEditOverlay();
}
function currentScaleForZoom() {
  const out = $('#outCanvas'), r = out.getBoundingClientRect();
  return out.width ? r.width / out.width : 1;
}
function zoomBy(dir) {
  const cur = App.zoom || currentScaleForZoom();
  let z;
  if (dir > 0) z = ZOOMS.find(v => v > cur + 1e-3) || ZOOMS[ZOOMS.length - 1];
  else z = [...ZOOMS].reverse().find(v => v < cur - 1e-3) || ZOOMS[0];
  App.zoom = z; applyZoom();
}

/* ---- webcam ---- */
async function startWebcam() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast('Camera API is not available in this browser', 'error');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream;
    $('#videoHost').appendChild(v);
    await v.play();
    setSource({ kind: 'webcam', video: v, stream, name: 'Webcam', w: v.videoWidth, h: v.videoHeight });
  } catch (e) { toast('Camera unavailable: ' + e.message, 'error'); }
}

/* ---- demos (generated locally, no files needed) ---- */
let demoCanvasCache = null;
function demoCanvas() {
  if (demoCanvasCache) return demoCanvasCache;
  const W = 960, H = 640, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0f2240'); sky.addColorStop(0.55, '#d0607a'); sky.addColorStop(1, '#ffc46b');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const sun = g.createRadialGradient(690, 300, 10, 690, 300, 170); sun.addColorStop(0, '#fff6d8'); sun.addColorStop(0.35, '#ffd28a'); sun.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = sun; g.beginPath(); g.arc(690, 300, 170, 0, 7); g.fill();
  const ridge = (base, a1, f1, a2, f2, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let x = 0; x <= W; x += 8) g.lineTo(x, base - a1 * Math.sin(x / f1) - a2 * Math.sin(x / f2 + 1.3)); g.lineTo(W, H); g.fill(); };
  ridge(430, 70, 140, 30, 41, '#4a2c5a'); ridge(500, 55, 95, 22, 29, '#2a1a3c'); ridge(570, 35, 70, 14, 23, '#120c1e');
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(140 + i * 26, 300 + i * 6); g.quadraticCurveTo(152 + i * 26, 290 + i * 6, 164 + i * 26, 300 + i * 6); g.stroke(); }
  g.fillStyle = '#ffffff'; g.font = 'bold 118px Georgia, "Times New Roman", serif'; g.fillText('Text Art', 56, 160);
  g.font = '600 34px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.9)'; g.fillText('image · gif · video  →  characters', 62, 214);
  return (demoCanvasCache = c);
}
async function demoImage() {
  const c = demoCanvas();
  setSource({ kind: 'image', bmp: await createImageBitmap(c), w: c.width, h: c.height, name: 'demo-sunset.png' });
}
async function demoAnim() {
  const W = 480, H = 320, frames = [], N = 48;
  for (let i = 0; i < N; i++) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const t = i / N, a = t * Math.PI * 2;
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, `hsl(${(t * 360) | 0},55%,18%)`); bg.addColorStop(1, `hsl(${((t * 360 + 140) | 0) % 360},60%,35%)`);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.save(); g.translate(150, 160); g.rotate(a);
    for (let k = 0; k < 5; k++) { g.rotate(Math.PI * 2 / 5); g.fillStyle = `hsl(${(k * 72 + t * 360) % 360},85%,62%)`; g.beginPath(); g.ellipse(48, 0, 46, 16, 0, 0, 7); g.fill(); }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 18, 0, 7); g.fill(); g.restore();
    const by = 250 - Math.abs(Math.sin(a * 2)) * 170;
    const ball = g.createRadialGradient(360 - 12, by - 12, 4, 360, by, 44); ball.addColorStop(0, '#fff'); ball.addColorStop(1, '#1e9be0');
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(360, 292, 40 - (250 - by) / 8, 8, 0, 0, 7); g.fill();
    g.fillStyle = ball; g.beginPath(); g.arc(360, by, 44, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 30px system-ui, sans-serif'; g.fillText('LOOP', 14 + Math.sin(a) * 10, 38);
    frames.push({ bmp: await createImageBitmap(c), delay: 60 });
  }
  const s = makeAnim(frames, W, H); s.name = 'demo-loop.gif'; setSource(s);
}

