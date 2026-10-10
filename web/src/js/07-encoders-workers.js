/* =====================================================================
   GIF encoder (LZW, per-frame local palettes, median-cut quantiser)
   ===================================================================== */
class ByteWriter {
  constructor(n = 1 << 16) { this.a = new Uint8Array(n); this.n = 0; }
  ensure(k) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new Uint8Array(m); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  byte(v) { this.ensure(1); this.a[this.n++] = v & 255; }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  bytes(arr) { this.ensure(arr.length); this.a.set(arr, this.n); this.n += arr.length; }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result() { return this.a.slice(0, this.n); }
}
/* The dictionary key (prefix code << 8 | byte) always fits 20 bits: a flat table instead of a Map.
   Only the slots used since the last clear code are reset. */
let LZW_TABLE = null, LZW_USED = null;
function lzwEncode(w, minCode, idx) {
  w.byte(minCode);
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1;
  const dict = LZW_TABLE || (LZW_TABLE = new Uint16Array(1 << 20)), used = LZW_USED || (LZW_USED = new Int32Array(4096));
  let nu = 0, acc = 0, nbits = 0;
  const block = new Uint8Array(255); let bl = 0;
  const flushBlock = () => { if (bl) { w.byte(bl); w.bytes(block.subarray(0, bl)); bl = 0; } };
  const emit = code => {
    acc |= code << nbits; nbits += size;
    while (nbits >= 8) { block[bl++] = acc & 255; acc >>>= 8; nbits -= 8; if (bl === 255) flushBlock(); }
  };
  try {
    emit(clear);
    let prefix = idx[0];
    for (let i = 1, len = idx.length; i < len; i++) {
      const k = idx[i], key = (prefix << 8) | k, hit = dict[key];
      if (hit !== 0) { prefix = hit; continue; }
      emit(prefix);
      if (next < 4096) {
        if (next === (1 << size) && size < 12) size++;
        dict[key] = next++; used[nu++] = key;
      } else {
        emit(clear); while (nu) dict[used[--nu]] = 0; size = minCode + 1; next = eoi + 1;
      }
      prefix = k;
    }
    emit(prefix);
    if (next === (1 << size) && size < 12) size++;   // mirror the decoder's table growth before EOI
    emit(eoi);
  } finally { while (nu) dict[used[--nu]] = 0; }
  if (nbits > 0) { block[bl++] = acc & 255; if (bl === 255) flushBlock(); }
  flushBlock(); w.byte(0);
}
class GifEncoder {
  /* global: optional palette shared by all frames ({ pal, size }), written once as the global colour table */
  constructor(w, h, loop = 0, global = null) {
    this.w = w; this.h = h; this.out = new ByteWriter(1 << 20);
    const o = this.out;
    o.str('GIF89a'); o.u16(w); o.u16(h);
    if (global) { const bitsz = Math.max(1, Math.round(Math.log2(global.size))); o.byte(0xF0 | (bitsz - 1)); o.byte(0); o.byte(0); o.bytes(global.pal.subarray(0, global.size * 3)); }
    else { o.byte(0x70); o.byte(0); o.byte(0); }
    o.byte(0x21); o.byte(0xFF); o.byte(11); o.str('NETSCAPE2.0'); o.byte(3); o.byte(1); o.u16(loop); o.byte(0);
  }
  addFrame(indices, palette, size, delayCs, transIndex = -1, disposal = 1) { gifFrameInto(this.out, indices, palette, size, delayCs, transIndex, disposal, this.w, this.h); }
  addFrameBytes(bytes) { this.out.bytes(bytes); }   // a frame encoded elsewhere (worker) with gifFrameBytes
  finish() { this.out.byte(0x3B); return this.out.result(); }
}
/* palette = null: the frame uses the global colour table (of the given size). x, y: position of a partial frame. */
function gifFrameInto(o, indices, palette, size, delayCs, transIndex, disposal, w, h, x = 0, y = 0) {
  const bitsz = Math.max(1, Math.round(Math.log2(size)));
  o.byte(0x21); o.byte(0xF9); o.byte(4);
  o.byte(((disposal & 7) << 2) | (transIndex >= 0 ? 1 : 0)); o.u16(delayCs); o.byte(transIndex >= 0 ? transIndex : 0); o.byte(0);
  o.byte(0x2C); o.u16(x); o.u16(y); o.u16(w); o.u16(h);
  if (palette) { o.byte(0x80 | (bitsz - 1)); o.bytes(palette.subarray(0, size * 3)); } else o.byte(0);
  lzwEncode(o, Math.max(2, bitsz), indices);
}
/* One complete GIF frame (control block, descriptor, palette, LZW data) from RGBA pixels.
   opt: { x, y } position of a partial frame, dither (error diffusion), global (shared palette from gifSharedPalette). */
function gifFrameBytes(rgba, colors, transparent, delayCs, disposal, w, h, opt) {
  const o = new ByteWriter(Math.max(4096, (w * h) >> 1)), x = opt && opt.x || 0, y = opt && opt.y || 0;
  if (opt && opt.global) {
    const P = opt.global, ind = opt.dither ? ditherToPalette(rgba, w, h, P.pal, P.near, transparent) : mapNearest(rgba, P.near, transparent);
    gifFrameInto(o, ind, null, P.size, delayCs, transparent && P.off ? 0 : -1, disposal, w, h, x, y);
  } else {
    const q = quantizeRGBA(rgba, colors, transparent, opt && opt.dither ? w : 0);
    gifFrameInto(o, q.ind, q.pal, q.size, delayCs, q.tIndex, disposal, w, h, x, y);
  }
  return o.result();
}
/* 15-bit colour histogram (counts and channel sums); add to H to combine several frames. */
function rgbaHistogram(data, transparent, H) {
  H = H || { cnt: new Uint32Array(32768), sr: new Float64Array(32768), sg: new Float64Array(32768), sb: new Float64Array(32768) };
  const { cnt, sr, sg, sb } = H;
  for (let o = 0; o < data.length; o += 4) {
    if (transparent && data[o + 3] < 128) continue;
    const r = data[o], g = data[o + 1], b = data[o + 2], k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
  }
  return H;
}
/* For every 15-bit colour, the nearest palette entry (perceptually weighted). */
function nearestLut(pal, off, n) {
  const lut = new Uint8Array(32768);
  for (let k = 0; k < 32768; k++) {
    const r = ((k >> 10) << 3) | 4, g = (((k >> 5) & 31) << 3) | 4, b = ((k & 31) << 3) | 4;
    let bi = off, bd = Infinity;
    for (let i = off; i < n; i++) { const dr = r - pal[i * 3], dg = g - pal[i * 3 + 1], db = b - pal[i * 3 + 2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (d < bd) { bd = d; bi = i; } }
    lut[k] = bi;
  }
  return lut;
}
function mapNearest(data, near, transparent) {
  const N = data.length >> 2, ind = new Uint8Array(N);
  for (let i = 0, o = 0; i < N; i++, o += 4) ind[i] = transparent && data[o + 3] < 128 ? 0 : near[((data[o] >> 3) << 10) | ((data[o + 1] >> 3) << 5) | (data[o + 2] >> 3)];
  return ind;
}
/* Floyd–Steinberg error diffusion onto a palette (smooth gradients instead of bands). */
function ditherToPalette(data, w, h, pal, near, transparent) {
  const ind = new Uint8Array(w * h);
  let cur = new Float32Array((w + 2) * 3), nxt = new Float32Array((w + 2) * 3);
  for (let y = 0; y < h; y++) {
    nxt.fill(0);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4, e = (x + 1) * 3;
      if (transparent && data[o + 3] < 128) { ind[i] = 0; continue; }
      const r = Math.min(255, Math.max(0, data[o] + cur[e])), g = Math.min(255, Math.max(0, data[o + 1] + cur[e + 1])), b = Math.min(255, Math.max(0, data[o + 2] + cur[e + 2]));
      const pi = near[(((r | 0) >> 3) << 10) | (((g | 0) >> 3) << 5) | ((b | 0) >> 3)];
      ind[i] = pi;
      const er = r - pal[pi * 3], eg = g - pal[pi * 3 + 1], eb = b - pal[pi * 3 + 2];
      cur[e + 3] += er * 7 / 16; cur[e + 4] += eg * 7 / 16; cur[e + 5] += eb * 7 / 16;
      nxt[e - 3] += er * 3 / 16; nxt[e - 2] += eg * 3 / 16; nxt[e - 1] += eb * 3 / 16;
      nxt[e] += er * 5 / 16; nxt[e + 1] += eg * 5 / 16; nxt[e + 2] += eb * 5 / 16;
      nxt[e + 3] += er / 16; nxt[e + 4] += eg / 16; nxt[e + 5] += eb / 16;
    }
    const t = cur; cur = nxt; nxt = t;
  }
  return ind;
}
/* Median-cut colour quantiser on a 15-bit histogram. ditherW: image width to dither (0 = nearest colour, no dithering). */
function quantizeRGBA(data, maxColors, transparent, ditherW) {
  const N = data.length >> 2;
  const cnt = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  const keys = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    if (transparent && data[o + 3] < 128) { keys[i] = 65535; continue; }
    const r = data[o], g = data[o + 1], b = data[o + 2], k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    keys[i] = k; cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
  }
  const P = paletteFromHistogram(cnt, sr, sg, sb, maxColors, transparent);
  let ind;
  if (ditherW) ind = ditherToPalette(data, ditherW, N / ditherW, P.pal, nearestLut(P.pal, P.off, P.n), transparent);
  else { ind = new Uint8Array(N); for (let i = 0; i < N; i++) ind[i] = keys[i] === 65535 ? 0 : P.lut[keys[i]]; }
  return { ind, pal: P.pal, size: P.size, tIndex: transparent ? 0 : -1 };
}
/* Median cut: palette (index 0 kept for transparency if asked) and the palette index of every histogram bin. */
function paletteFromHistogram(cnt, sr, sg, sb, maxColors, transparent) {
  const bins = []; for (let k = 0; k < 32768; k++) if (cnt[k]) bins.push(k);
  const maxC = Math.max(2, Math.min(256, maxColors)) - (transparent ? 1 : 0);
  let boxes;
  if (bins.length <= maxC) boxes = bins.map(k => [k]);
  else {
    const mk = list => {
      let count = 0, r0 = 31, g0 = 31, b0 = 31, r1 = 0, g1 = 0, b1 = 0;
      for (let i = 0; i < list.length; i++) {
        const k = list[i], r = k >> 10, g = (k >> 5) & 31, b = k & 31; count += cnt[k];
        if (r < r0) r0 = r; if (r > r1) r1 = r; if (g < g0) g0 = g; if (g > g1) g1 = g; if (b < b0) b0 = b; if (b > b1) b1 = b;
      }
      const rng = [(r1 - r0) * 1.0, (g1 - g0) * 1.2, (b1 - b0) * 0.8];
      const ch = rng[0] >= rng[1] && rng[0] >= rng[2] ? 0 : rng[1] >= rng[2] ? 1 : 2;
      return { list, count, ch, score: list.length > 1 ? Math.sqrt(count) * (rng[ch] + 1) : -1 };
    };
    // stable counting sort of a box by one 5-bit channel (same order as a stable comparison sort)
    const sortBy = (list, ch) => {
      const sh = ch === 0 ? 10 : ch === 1 ? 5 : 0, start = new Int32Array(33), out = new Array(list.length);
      for (let i = 0; i < list.length; i++) start[((list[i] >> sh) & 31) + 1]++;
      for (let v = 0; v < 32; v++) start[v + 1] += start[v];
      for (let i = 0; i < list.length; i++) { const k = list[i]; out[start[(k >> sh) & 31]++] = k; }
      return out;
    };
    boxes = [mk(bins)];
    while (boxes.length < maxC) {
      let bi = -1, best = 0;
      for (let i = 0; i < boxes.length; i++) if (boxes[i].score > best) { best = boxes[i].score; bi = i; }
      if (bi < 0) break;
      const bx = boxes[bi], ch = bx.ch;
      bx.list = sortBy(bx.list, ch);
      let half = bx.count / 2, s = 0, cut = 1;
      for (let i = 0; i < bx.list.length - 1; i++) { s += cnt[bx.list[i]]; if (s >= half) { cut = i + 1; break; } cut = i + 1; }
      boxes.splice(bi, 1, mk(bx.list.slice(0, cut)), mk(bx.list.slice(cut)));
    }
    boxes = boxes.map(b => b.list);
  }
  const off = transparent ? 1 : 0, nColors = boxes.length + off;
  let size = 2; while (size < nColors) size <<= 1;
  const pal = new Uint8Array(size * 3), lut = new Uint8Array(32768);
  boxes.forEach((box, bi) => {
    let c = 0, r = 0, g = 0, b = 0;
    for (const k of box) { c += cnt[k]; r += sr[k]; g += sg[k]; b += sb[k]; }
    const pi = bi + off; pal[pi * 3] = Math.round(r / c); pal[pi * 3 + 1] = Math.round(g / c); pal[pi * 3 + 2] = Math.round(b / c);
    for (const k of box) lut[k] = pi;
  });
  return { pal, size, n: nColors, off, lut };
}

/* ---------------- ZIP + BMP writers ----------------
   makeZip stores files as they are; entries may come already compressed ({ data, method: 8, crc, size } from makeZipAsync). */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let offset = 0, cdSize = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = f.crc != null ? f.crc : crc32(data), method = f.method || 0, size = f.size != null ? f.size : data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h, name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(c, name);
    offset += 30 + name.length + data.length; cdSize += 46 + name.length;
  }
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}
function encodeBMP(img) {
  const { width: w, height: h, data } = img, row = (w * 3 + 3) & ~3, size = 54 + row * h;
  const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint16(0, 0x4D42, true); dv.setUint32(2, size, true); dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; u8[o++] = data[i + 2]; u8[o++] = data[i + 1]; u8[o++] = data[i]; }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/* The conversion engine as worker source, built from the live functions and tables above (one source of truth).
   Inside a worker every source is new, so nothing is cached between messages (srcKey → null). */
function engineSource() {
  const data = { EDGES_WASM, CHARSETS, MODES, FONTS, DEFAULTS, BRAILLE_BIT, BRAILLE_POS, QUAD_CHARS, HALF_CHARS, HALFTONE_RAMP, ANSI16, ANSI256, DISCORD_CSS, DISCORD_HUES, CONVERT_KEYS,
    RETRO_PALETTES, WIDE_CONT, EMOJI_SETS, EMOJI_FONT, PIXEL_FONT_DATA, BLOCK_RECTS, BOX_ARMS, DOT_SIZES };
  const arrows = { clamp, lumRGB, hex6, fontCss, transformSig, resultBytes, isBlankCp, outlineAmount, convertSig, u32le, webpSize };
  const fns = [hexToRgb, newCanvas, scratchBuf, cropRect, normRot, gridFor, stepCanvas, drawTransformed, bayerMatrix, hashNoise, quantizeGrid,
    getGlyphTable, glyphOrder, getRamp, glyphChars, sobel, hiFactor, hiPixels, samplePixels, wasmEdges, edgeGradients, outlineMap, dirCharCp, localStats, backgroundMask, memoKey, maskFor, convert, convertRaw, convertCore,
    applyOverlay, wrapCaption, captionRaster, retroColour, emojiTable, nearestEmoji, pixelGlyph, pixelCharRects, drawPixelText, paletteKey, customPal, parsePaletteText,
    appColour, discordCode, pictureSize, cellSize, chr, groupsOf, renderBackground, renderResult, resultText, quantizeRGBA, paletteFromHistogram, rgbaHistogram, nearestLut, mapNearest, ditherToPalette,
    lzwEncode, gifFrameInto, gifFrameBytes, gifJobBytes, zlibDeflate, pngFiltered, apngJobBytes, webpStill, webpJobBytes, clearEngineCaches];
  // functions are copied by their source text: an arrow function here would lose its name in the worker
  for (const f of fns) if (typeof f !== 'function' || !/^(async\s+)?function[\s*]/.test(f.toString())) throw new Error(`engineSource: "${f && f.name}" must be a function declaration (arrows go in the arrows list)`);
  return [
    ...Object.entries(data).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`),
    ...Object.entries(arrows).map(([k, v]) => `const ${k} = ${v.toString()};`),
    LRU.toString(), ByteWriter.toString(), ...fns.map(f => f.toString()),
    `const RENDER_ONLY_KEYS = new Set(${JSON.stringify([...RENDER_ONLY_KEYS])});`,
    'const scratch = new Map(), stepCanvases = new Map(), glyphCache = new Map(), appCache = new Map(), chrCache = new Map(), gradSlots = [];',
    'const sampleCache = new LRU(0, 0), outlineCache = new LRU(0, 0), resultCache = new LRU(0, 0);',
    'const BAYER4 = bayerMatrix(4), BAYER8 = bayerMatrix(8);',
    'const work = { sample: newCanvas() }, sctx = work.sample.getContext("2d", { willReadFrequently: true });',
    'const hiCanvas = newCanvas(), hiCtx = hiCanvas.getContext("2d", { willReadFrequently: true });',
    'let LZW_TABLE = null, LZW_USED = null, edgesWasm;',
    'function srcKey() { return null; }',
    'function maskPixels() { return null; }',
    'function withOverlay(r) { return r; }',
    'const capCache = new Map(), ovApply = (r, ov) => ov ? applyOverlay(r, ov) : r, emojiTables = new Map();',
    'let pixelGlyphs = null; const customPals = new Map();',
  ].join('\n');
}
/* ---------------- worker pool ----------------
   Conversion (from pixels drawn on this thread), drawing and encoding of frames run on background threads,
   several at once, so playback and exports use every core and the page stays responsive. The workers are built
   from the functions above: same code, same results. Without workers (or with window.__noWorkers = true, for
   testing) everything runs on this thread as before. */
const Pool = (() => {
  let workers = null, seq = 0;
  const jobs = new Map();
  const source = () => `'use strict';
${engineSource()}
const canvasFor = bm => { const c = new OffscreenCanvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); bm.close(); return c; };
const resTransfer = r => [r.cp.buffer, r.fg.buffer, r.bgc && r.bgc.buffer, r.bits && r.bits.buffer, r.val && r.val.buffer, r.ov && r.ov.buffer].filter(Boolean);
const frameCanvas = new OffscreenCanvas(1, 1), frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });
onmessage = async e => {
  const { id, op, a } = e.data;
  try {
    let r, tr = [];
    if (op === 'gif') { r = gifJobBytes(a); tr = [r.buffer]; }
    else if (op === 'apng') { r = await apngJobBytes(a); tr = [r.data.buffer]; }
    else if (op === 'webp') { r = await webpJobBytes(a); tr = [r.bits.buffer].concat(r.alph ? [r.alph.buffer] : []); }
    else if (op === 'renderFrame') {   // (convert +) draw one animation frame → RGBA
      const res = a.res || ovApply(convertCore(null, a.sw, a.sh, a.St, null, a.pre), a.ov);
      renderResult(res, a.St, frameCanvas, a.scale, a.ropts || {});
      if (frameCanvas.width !== a.w || frameCanvas.height !== a.h) throw new Error('frame size changed');
      r = frameCtx.getImageData(0, 0, a.w, a.h).data; tr = [r.buffer];
    }
    else if (op === 'sizes') { const c = canvasFor(a.img); r = []; for (const t of a.types) { const b = await c.convertToBlob({ type: t, quality: a.quality }); r.push(b.type === t ? b.size : -1); } }
    else if (op === 'convertPre') { r = convertCore(null, a.sw, a.sh, a.St, null, a.pre); tr = resTransfer(r); }
    else if (op === 'pngFrame') {   // (convert +) draw + PNG of one animation frame, plus its text
      const res = a.res || ovApply(convertCore(null, a.sw, a.sh, a.St, null, a.pre), a.ov);
      const c = new OffscreenCanvas(1, 1); renderResult(res, a.St, c, a.scale);
      const png = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
      r = { png, text: resultText(res) }; tr = [png.buffer];
    }
    postMessage({ id, r }, tr);
  } catch (err) { postMessage({ id, err: String(err && err.message || err) }); }
};`;
  function init() {
    if (workers) return workers;
    workers = [];
    try {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return workers;
      const url = URL.createObjectURL(new Blob([source()], { type: 'text/javascript' }));
      const n = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 8);
      for (let i = 0; i < n; i++) {
        const w = new Worker(url); w.busy = 0;
        w.onmessage = e => {
          const j = jobs.get(e.data.id); if (!j) return; jobs.delete(e.data.id); w.busy--;
          if (e.data.err) { failures.push(e.data.err); console.warn('background job failed (done here instead):', e.data.err); j.rej(new Error(e.data.err)); } else j.res(e.data.r);
        };
        w.onerror = e => { e.preventDefault(); console.warn('worker failed', e.message, e.lineno); for (const [id, j] of jobs) if (j.w === w) { jobs.delete(id); j.rej(new Error('worker failed: ' + e.message)); } w.busy = 1e9; };
        workers.push(w);
      }
    } catch (e) { console.warn('workers unavailable', e); workers = []; }
    return workers;
  }
  const failures = [];   // jobs that failed on a worker (they are redone on this thread, so only the tests notice)
  return {
    failures,
    size: () => typeof window !== 'undefined' && window.__noWorkers ? 0 : init().filter(w => w.busy < 1e9).length,
    run(op, a, transfer) {
      const ws = this.size() ? init().filter(w => w.busy < 1e9) : [];
      if (!ws.length) return Promise.reject(new Error('no workers'));
      const w = ws.reduce((b, x) => x.busy < b.busy ? x : b), id = ++seq;
      w.busy++;
      return new Promise((res, rej) => { jobs.set(id, { res, rej, w }); w.postMessage({ id, op, a }, transfer || []); });
    },
  };
})();
/* Per-frame jobs that run in parallel on the pool (bounded, so memory stays small) and come back in order.
   remote() runs a job on a worker; local() is the main-thread fallback with the same result. */
class OrderedJobs {
  constructor() { this.list = []; this.count = 0; this.done = 0; this.head = 0; this.limit = Math.max(2, Pool.size() * 2); }
  async add(remote, local) {
    this.count++;
    if (!remote || !Pool.size()) { this.list.push(Promise.resolve(local())); this.done++; return; }
    this.list.push(remote().catch(() => local()).then(r => { this.done++; return r; }));
    while (this.list.length - this.head >= this.limit) await this.list[this.head++];   // bounded: wait for the oldest
  }
  async all(onProgress) {
    const out = new Array(this.list.length);
    for (let i = 0; i < this.list.length; i++) { out[i] = await this.list[i]; if (onProgress && i % 4 === 3) onProgress(i + 1); }
    return out;
  }
}

/* Conversion on a worker: the canvas work (resampling) is done here, the rest there. Same result as convert(). */
function convertOnWorker(src, sw, sh, St) {
  const pre = convertInputs(src, sw, sh, St);
  return Pool.run('convertPre', { pre, sw, sh, St });
}
/* Arguments for a worker job that draws (and converts) one export frame: the memoised result if there is one,
   otherwise the pre-drawn pixels (and the overlay to put on the conversion). local() does the same on this thread. */
function frameJobArgs(f, St) {
  if (f.text != null) return { res: textResult(f.text, St, f.ansi) };
  const res = peekResult(f.d, f.w, f.h, St);
  return res ? { res: withOverlay(res, St) } : { pre: convertInputs(f.d, f.w, f.h, St), sw: f.w, sh: f.h, ov: overlaySpec(St) };
}
const frameJobResult = (a, St) => a.res || withOverlay(convertCore(null, a.sw, a.sh, St, null, a.pre), St);

