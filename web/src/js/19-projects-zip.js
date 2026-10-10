/* =====================================================================
   Compressed ZIP (write + read) and project files (.textart)
   ===================================================================== */
/* deflate / inflate with the browser's own streams (no library) */
const canDeflate = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
const streamBytes = async (u8, ts) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ts)).arrayBuffer());
const deflateRaw = u8 => streamBytes(u8, new CompressionStream('deflate-raw'));
const inflateRaw = u8 => streamBytes(u8, new DecompressionStream('deflate-raw'));
const ALREADY_COMPRESSED = /\.(png|jpe?g|gif|webp|avif|mp4|m4v|webm|mov|mkv|ogv|ogg|zip|textart|gz)$/i;
/* A ZIP whose entries are compressed where that makes them smaller (text, HTML, BMP…); pictures and videos are stored. */
async function makeZipAsync(files, progress) {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i], crc = crc32(f.data);
    let e = { name: f.name, data: f.data, crc, size: f.data.length, method: 0 };
    if (canDeflate() && f.data.length > 96 && !ALREADY_COMPRESSED.test(f.name)) {
      const z = await deflateRaw(f.data);
      if (z.length + 8 < f.data.length) e = Object.assign(e, { data: z, method: 8 });
    }
    out.push(e);
    if (progress && i % 8 === 7) { progress((i + 1) / files.length); await nextTick(); }
  }
  return makeZip(out);
}
/* the files of a ZIP → Map(name → bytes); stored and deflated entries, CRC checked */
async function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder(), files = new Map();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('damaged ZIP directory');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    let data = u8.subarray(start, start + csize);
    if (method === 8) data = await inflateRaw(data);
    else if (method !== 0) throw new Error(`"${name}" uses an unsupported compression`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`"${name}" is damaged`);
    files.set(name, data);
  }
  return files;
}
function bytesToBase64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function base64ToBytes(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
const typedToB64 = a => bytesToBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const b64ToTyped = (b, Type) => { const u = base64ToBytes(b); return new Type(u.buffer, 0, u.byteLength / Type.BYTES_PER_ELEMENT); };

/* ---- project: the source, every setting, crop / turn, trim, mask, hand edits and captions in one .textart (ZIP) ---- */
const PROJECT_SKIP = new Set(['calib']);   // device-specific
/* the project of the open source: meta (project.json) and its files. Source files may come as a Blob (blob), so a
   big video is not copied; withSource false leaves the source file out (the session keeps it separately). */
async function projectParts(withSource = true) {
  const s = App.src; if (!s) throw new Error('nothing is open');
  maskFlush();
  const files = [], settings = {};
  for (const k in DEFAULTS) if (!PROJECT_SKIP.has(k)) settings[k] = S[k];
  const meta = { format: 'textart', version: 1, app: 'Text Art Studio', saved: new Date().toISOString(), settings, look: App.look || null, view: App.view,
    trim: { in: App.tin, out: App.tout }, time: curTime() };
  const src = meta.source = { kind: s.kind, name: s.name || 'picture' };
  const pngOf = async c => new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
  if (s.kind === 'text') {
    src.text = s.text;
    if (s.ansi) src.ansi = { cols: s.ansi.cols, rows: s.ansi.rows, cp: typedToB64(s.ansi.cp), fg: typedToB64(s.ansi.fg), bg: typedToB64(s.ansi.bg) };
  } else if (s.effect) {   // an animation made from a still picture: the picture and the effect
    src.effect = { kind: s.effect.kind, opts: s.effect.opts, file: 'source' + (s.effect.ext || '.png') };
    src.mime = s.effect.mime || 'image/png';
    if (withSource) files.push({ name: src.effect.file, data: s.effect.bytes, source: true });
  } else if (s.file) {
    const ext = ((s.file.name || s.name || '').match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0].toLowerCase();
    src.file = 'source' + ext; src.mime = s.mime || s.file.type || '';
    if (withSource) files.push({ name: src.file, blob: s.file, source: true });
  } else if (s.kind === 'anim' && s.name === 'demo-loop.gif') src.demo = 'anim';
  else {   // no file behind it (demo picture, webcam, generated): the current frame as a PNG
    const d = currentDrawable(); if (!d) throw new Error('the picture is not ready yet');
    const c = document.createElement('canvas'); c.width = d[1]; c.height = d[2]; c.getContext('2d').drawImage(d[0], 0, 0, d[1], d[2]);
    Object.assign(src, { kind: 'image', file: 'source.png', mime: 'image/png' });
    if (s.kind === 'webcam') src.name = 'webcam.png';
    if (withSource) files.push({ name: 'source.png', data: await pngOf(c), source: true });
  }
  if (Mask.canvas && Mask.src === s && Mask.ver) {   // raw pixels (exact; the ZIP compresses them), not a PNG (alpha would round)
    const m = Mask.canvas, px = m.getContext('2d').getImageData(0, 0, m.width, m.height).data;
    meta.mask = { file: 'mask.rgba', w: m.width, h: m.height };
    files.push({ name: 'mask.rgba', data: new Uint8Array(px.buffer, px.byteOffset, px.byteLength) });
  }
  layerProjectFiles(meta, files);
  if (Ramps.list.length) meta.ramps = Ramps.list.map(r => Object.assign({}, r));
  if (Versions.list.length) meta.versions = Versions.list.map(v => ({ name: v.name, settings: v.settings }));
  if (Edits.cells.size) meta.edits = { cols: Edits.cols, rows: Edits.rows, cells: Array.from(Edits.cells, ([i, e]) => [i, e.cp, e.rgb == null ? -1 : e.rgb]) };
  return { meta, files };
}
async function projectBlob() {
  const { meta, files } = await projectParts(true);
  for (const f of files) if (f.blob) f.data = new Uint8Array(await f.blob.arrayBuffer());
  return makeZipAsync([{ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 1)) }, ...files]);
}
async function saveProject() {
  if (!App.src) return toast('Open a picture first');
  if (App.exporting) return toast('Wait for the export to finish first');
  showProgress('Saving the project', true);
  try {
    const blob = await projectBlob();
    download(new Blob([blob], { type: 'application/x-textart+zip' }), baseName() + '.textart');
    toast(`Project saved (${fmtBytes(blob.size)}). Open it here any time to continue`);
  } catch (e) { console.error(e); toast('Could not save the project: ' + (e && e.message || e), 'error'); }
  finally { hideProgress(); }
}
const isZipHead = h => h[0] === 0x50 && h[1] === 0x4b && h[2] === 3 && h[3] === 4;
async function openProject(file) {
  let z, meta;
  try {
    z = await readZip(new Uint8Array(await file.arrayBuffer()));
    const pj = z.get('project.json'); if (!pj) throw new Error('this ZIP is not a Text Art Studio project');
    meta = JSON.parse(new TextDecoder().decode(pj));
    if (meta.format !== 'textart' || !meta.source) throw new Error('this is not a Text Art Studio project');
  } catch (e) { toast('Could not open the project: ' + e.message, 'error'); return false; }
  const ok = await openProjectParts(meta, name => z.get(name));
  if (ok) toast('Project opened: ' + (file.name || meta.source.name));
  return ok;
}
/* opens a project from its meta and get(name) → the bytes (or Blob) of one of its files */
async function openProjectParts(meta, get) {
  const src = meta.source, before = App.src;
  // the settings first, so the source opens with its own look
  const st = {}; for (const k in meta.settings || {}) if (k in DEFAULTS && !PROJECT_SKIP.has(k) && typeof meta.settings[k] === typeof DEFAULTS[k]) st[k] = meta.settings[k];
  try {
    if (src.kind === 'text') {
      const a = src.ansi && { cols: src.ansi.cols, rows: src.ansi.rows, cp: b64ToTyped(src.ansi.cp, Uint32Array), fg: b64ToTyped(src.ansi.fg, Int32Array), bg: b64ToTyped(src.ansi.bg, Int32Array) };
      setTextSource(src.text, src.name, a || null);
    } else if (src.effect && get(src.effect.file)) {
      await makeEffectAnim(src.effect.kind, src.effect.opts, new File([get(src.effect.file)], src.name, { type: src.mime || 'image/png' }), true);
    } else if (src.demo === 'anim') await demoAnim();
    else if (src.file && get(src.file)) await openFile(new File([get(src.file)], src.name, { type: src.mime || '' }));
    else throw new Error('the picture is missing from the project');
  } catch (e) { console.error(e); toast('Could not open the project: ' + e.message, 'error'); return false; }
  if (!App.src || App.src === before) return false;
  applySettings(st);
  await layerFromProject(meta, get);
  UndoHistory.reset();
  Ramps.list = Array.isArray(meta.ramps) ? meta.ramps.filter(r => r && RAMP_KEYS[r.key] && isFinite(r.from) && isFinite(r.to)).map(r => ({ key: r.key, from: +r.from, to: +r.to, ease: RAMP_EASES[r.ease] ? r.ease : 'linear', t0: isFinite(r.t0) ? Math.max(0, +r.t0) : null, t1: isFinite(r.t1) ? Math.max(0, +r.t1) : null })) : [];
  buildRampsUI(); rampsChanged();
  if (Array.isArray(meta.versions)) {
    Versions.list = meta.versions.filter(v => v && /^[ABCD]$/.test(v.name) && v.settings).map(v => {
      const o = {}; for (const k in v.settings) if (k in DEFAULTS && !VERSION_SKIP.has(k) && typeof v.settings[k] === typeof DEFAULTS[k]) o[k] = v.settings[k];
      return { name: v.name, settings: Object.assign(versionSnap(), o) };
    });
    buildVersions();
  }
  App.look = meta.look && lookSettings(meta.look) ? meta.look : null; markLooks();
  editsClear();
  if (meta.edits && Array.isArray(meta.edits.cells)) {
    Edits.cols = meta.edits.cols | 0; Edits.rows = meta.edits.rows | 0;
    for (const [i, cp, rgb] of meta.edits.cells) Edits.cells.set(i | 0, { cp: cp >>> 0, rgb: rgb < 0 ? null : rgb | 0 });
    Edits.ver++;
  }
  if (meta.mask && get(meta.mask.file) && App.src.kind !== 'text') {
    try {
      const m = maskEnsure(), g = m.canvas.getContext('2d'), raw = get(meta.mask.file), w = meta.mask.w | 0, h = meta.mask.h | 0;
      if (raw.length !== w * h * 4) throw new Error('mask size');
      const img = new ImageData(new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length), w, h);
      if (w === m.canvas.width && h === m.canvas.height) g.putImageData(img, 0, 0);
      else { const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(img, 0, 0); g.clearRect(0, 0, m.canvas.width, m.canvas.height); g.drawImage(t, 0, 0, m.canvas.width, m.canvas.height); }
      Mask.pending = true;
    } catch (e) { console.warn('mask', e); }
  }
  if (meta.trim) { App.tin = typeof meta.trim.in === 'number' ? meta.trim.in : null; App.tout = typeof meta.trim.out === 'number' ? meta.trim.out : null; updateTrimBar(); }
  if (meta.time > 0 && duration()) seekTo(meta.time);
  if (meta.view && ['out', 'split', 'wipe', 'src', 'text', 'platform'].includes(meta.view)) setView(meta.view);
  App.dirty = true;
  return true;
}
function initProjects() {
  $('#btnSaveProject').addEventListener('click', saveProject);
  $('#btnOpenProject').addEventListener('click', () => $('#fileInput').click());
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key || '').toLowerCase() === 's') { e.preventDefault(); if (!document.querySelector('dialog[open]')) saveProject(); }
  });
}
