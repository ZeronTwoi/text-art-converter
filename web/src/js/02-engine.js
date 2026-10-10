/* =====================================================================
   Conversion engine
   ===================================================================== */
/* Canvases of the engine. Resampling (drawTransformed) always runs on the page's thread: canvas filtering differs
   between threads, so workers only ever get pixels. In a worker there is no document: OffscreenCanvas instead. */
function newCanvas(w = 300, h = 150) {
  if (typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const work = { sample: newCanvas(), a: newCanvas(), b: newCanvas() };
const sctx = work.sample.getContext('2d', { willReadFrequently: true });

/* ---- performance: reusable scratch buffers + caches ----
   Big typed arrays are reused between frames instead of being reallocated (that was mostly GC time).
   Immutable sources (ImageBitmaps, a paused video frame) get a key, so work that does not depend on
   the changed setting is reused: the resampled pixels, the edge gradients and whole results. */
const scratch = new Map();
function scratchBuf(name, Type, n) {
  let b = scratch.get(name);
  if (!b || b.constructor !== Type || b.length < n) { b = new Type(n); scratch.set(name, b); }
  return b.length === n ? b : b.subarray(0, n);
}
class LRU {
  constructor(maxBytes, maxN) { this.maxBytes = maxBytes; this.maxN = maxN; this.m = new Map(); this.bytes = 0; }
  get(k) { const e = this.m.get(k); if (!e) return undefined; this.m.delete(k); this.m.set(k, e); return e.v; }
  set(k, v, bytes) {
    const old = this.m.get(k); if (old) { this.bytes -= old.b; this.m.delete(k); }
    if (bytes > this.maxBytes) return;
    this.m.set(k, { v, b: bytes }); this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.m.size > this.maxN) { const [k0, e0] = this.m.entries().next().value; this.m.delete(k0); this.bytes -= e0.b; }
  }
  clear() { this.m.clear(); this.bytes = 0; }
}
const sampleCache = new LRU(48e6, 48), outlineCache = new LRU(32e6, 48), resultCache = new LRU(128e6, 6000);
const srcIds = new WeakMap(); let srcIdNext = 1;
/* Identity of a drawable whose pixels cannot change, or null (playing video, webcam, canvases). */
function srcKey(src) {
  if (!src) return null;
  let tag = '';
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) tag = 'b';
  else if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) {
    if (!src.paused || src.seeking || src.srcObject || src.readyState < 2) return null;
    tag = 'v';
  } else return null;
  let id = srcIds.get(src); if (!id) { id = srcIdNext++; srcIds.set(src, id); }
  return tag + id + (tag === 'v' ? '@' + src.currentTime : '');
}
const transformSig = S => [S.cropL, S.cropR, S.cropT, S.cropB, normRot(S.rotate), !!S.flipH, !!S.flipV].join();
function clearEngineCaches() {
  sampleCache.clear(); outlineCache.clear(); resultCache.clear();
  for (const s of gradSlots) s.key = null;
  for (const c of stepCanvases.values()) c.width = c.height = 0;
  stepCanvases.clear();
}

function cropRect(sw, sh, S) {
  const l = clamp(S.cropL, 0, 95) / 100, r = clamp(S.cropR, 0, 95) / 100, t = clamp(S.cropT, 0, 95) / 100, b = clamp(S.cropB, 0, 95) / 100;
  return [sw * l, sh * t, Math.max(1, sw * (1 - l - r)), Math.max(1, sh * (1 - t - b))];
}
function normRot(r) { return ((Math.round((+r || 0) / 90) * 90) % 360 + 360) % 360; }
function gridFor(sw, sh, S) {
  const m = MODES[S.mode];
  let [, , w, h] = cropRect(sw, sh, S);
  if (normRot(S.rotate) % 180) [w, h] = [h, w];
  const cols = clamp(Math.round(S.cols) || 1, 1, 2000);
  const rows = clamp(Math.round(cols * (h / w) / S.charAspect), 1, 4000);
  return { cols, rows, sx: m.sx, sy: m.sy, W: cols * m.sx, H: rows * m.sy };
}
/* Scratch canvases for the halving steps, one per exact size: a larger, reused canvas would let the
   smoothed (mipmapped) downscale pick up stale pixels of earlier images outside the drawn area. */
const stepCanvases = new Map();
function stepCanvas(w, h) {
  const k = w + 'x' + h; let c = stepCanvases.get(k);
  if (c) { stepCanvases.delete(k); stepCanvases.set(k, c); return c; }
  c = newCanvas(w, h); stepCanvases.set(k, c);
  if (stepCanvases.size > 16) { const [k0, c0] = stepCanvases.entries().next().value; c0.width = c0.height = 0; stepCanvases.delete(k0); }
  return c;
}
/* Draws source (cropped, rotated, flipped) into ctx at W×H, with stepwise downscaling for quality. */
function drawTransformed(ctx, src, sw, sh, W, H, S) {
  let [ix, iy, iw, ih] = cropRect(sw, sh, S);
  const rot = normRot(S.rotate), swap = rot === 90 || rot === 270;
  const dw = swap ? H : W, dh = swap ? W : H;
  let img = src;
  while (iw > dw * 2.2 && ih > dh * 2.2) {
    const nw = Math.max(1, Math.round(iw / 2)), nh = Math.max(1, Math.round(ih / 2));
    const t = stepCanvas(nw, nh);
    const tc = t.getContext('2d');
    tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
    tc.clearRect(0, 0, nw, nh); tc.drawImage(img, ix, iy, iw, ih, 0, 0, nw, nh);
    img = t; ix = 0; iy = 0; iw = nw; ih = nh;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.translate(W / 2, H / 2);
  ctx.scale(S.flipH ? -1 : 1, S.flipV ? -1 : 1);
  ctx.rotate(rot * Math.PI / 180);
  ctx.drawImage(img, ix, iy, iw, ih, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/* ---- dithering / quantisation ---- */
function bayerMatrix(n) {
  let m = [0], size = 1;
  while (size < n) {
    const s2 = size * 2, nm = new Array(s2 * s2);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = m[y * size + x] * 4;
      nm[y * s2 + x] = v; nm[y * s2 + x + size] = v + 2; nm[(y + size) * s2 + x] = v + 3; nm[(y + size) * s2 + x + size] = v + 1;
    }
    m = nm; size = s2;
  }
  return m.map(v => (v + 0.5) / (n * n));
}
const BAYER4 = bayerMatrix(4), BAYER8 = bayerMatrix(8);
function hashNoise(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* v: Float32Array 0..1 (W×H). Returns Uint8Array of level indices 0..levels-1. */
function quantizeGrid(v, W, H, levels, method, threshold) {
  const out = new Uint8Array(W * H), n = Math.max(1, levels - 1), bias = 0.5 - threshold;
  if (method === 'floyd' || method === 'atkinson') {
    const e = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) e[i] = v[i] + bias;
    const atk = method === 'atkinson';
    for (let y = 0; y < H; y++) {
      const rev = !atk && (y & 1), dir = rev ? -1 : 1;
      for (let k = 0; k < W; k++) {
        const x = rev ? W - 1 - k : k, i = y * W + x, old = e[i];
        const q = clamp(Math.round(old * n), 0, n);
        out[i] = q;
        const err = old - q / n;
        if (atk) {
          const f = err / 8;
          if (x + 1 < W) e[i + 1] += f;
          if (x + 2 < W) e[i + 2] += f;
          if (y + 1 < H) { if (x > 0) e[i + W - 1] += f; e[i + W] += f; if (x + 1 < W) e[i + W + 1] += f; }
          if (y + 2 < H) e[i + 2 * W] += f;
        } else {
          const xn = x + dir;
          if (xn >= 0 && xn < W) e[i + dir] += err * 7 / 16;
          if (y + 1 < H) {
            const xp = x - dir;
            if (xp >= 0 && xp < W) e[i + W - dir] += err * 3 / 16;
            e[i + W] += err * 5 / 16;
            if (xn >= 0 && xn < W) e[i + W + dir] += err / 16;
          }
        }
      }
    }
    return out;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, val = (v[i] + bias) * n;
    let t;
    if (method === 'bayer4') t = BAYER4[(y & 3) * 4 + (x & 3)];
    else if (method === 'bayer8') t = BAYER8[(y & 7) * 8 + (x & 7)];
    else if (method === 'noise') t = hashNoise(x, y);
    else t = 0.5;
    out[i] = clamp(Math.floor(val + t), 0, n);
  }
  return out;
}

/* ---- glyph coverage tables (for ramp sorting & shape matching) ---- */
const glyphCache = new Map();
function getGlyphTable(chars, family) {
  const key = family + '\u0000' + chars.join('');
  let t = glyphCache.get(key);
  if (t) return t;
  const GX = 4, GY = 8, CW = 24, CH = 48;
  const c = newCanvas(CW, CH);
  const g = c.getContext('2d', { willReadFrequently: true });
  const n = chars.length, vecs = new Float32Array(n * GX * GY), mean = new Float32Array(n);
  g.font = Math.round(CW / 0.6) + 'px ' + family; g.textAlign = 'center'; g.textBaseline = 'middle';
  let max = 0;
  const bw = CW / GX, bh = CH / GY;
  const pixel = family === FONTS.pixel, R = [];
  for (let i = 0; i < n; i++) {
    g.fillStyle = '#000'; g.fillRect(0, 0, CW, CH);
    g.fillStyle = '#fff';
    R.length = 0;
    if (pixel && pixelCharRects(chars[i].codePointAt(0), 0, 0, CW, CH, R)) { g.beginPath(); for (let j = 0; j < R.length; j += 4) g.rect(R[j], R[j + 1], R[j + 2], R[j + 3]); g.fill(); }
    else g.fillText(chars[i], CW / 2, CH / 2 + 1);
    const d = g.getImageData(0, 0, CW, CH).data;
    let sum = 0;
    for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
      let s = 0;
      for (let y = gy * bh; y < (gy + 1) * bh; y++) for (let x = gx * bw; x < (gx + 1) * bw; x++) s += d[(y * CW + x) * 4];
      const v = s / 255 / (bw * bh);
      vecs[i * 32 + gy * GX + gx] = v; sum += v; if (v > max) max = v;
    }
    mean[i] = sum / 32;
  }
  if (max > 0) for (let j = 0; j < vecs.length; j++) vecs[j] /= max;
  t = { chars, vecs, mean };
  if (glyphCache.size > 40) glyphCache.clear();
  glyphCache.set(key, t);
  return t;
}
/* Glyph indices sorted by the sum of their coverage vector (for the pruned nearest-glyph search). */
function glyphOrder(T) {
  if (!T.ord) {
    const n = T.chars.length, sum = new Float64Array(n);
    for (let g = 0; g < n; g++) { let s = 0; for (let j = 0; j < 32; j++) s += T.vecs[g * 32 + j]; sum[g] = s; }
    T.ord = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => sum[a] - sum[b] || a - b);
    T.ordSum = Float64Array.from(T.ord, g => sum[g]);
  }
  return T;
}
function getRamp(S) {
  let chars = S.charset === 'custom' ? S.customChars : (CHARSETS[S.charset] || CHARSETS.standard).chars;
  chars = Array.from(new Set(Array.from(chars || '').filter(c => c !== '\n' && c !== '\t')));
  if (chars.length < 2) chars = [' ', '#'];
  if (S.sortRamp) {
    const t = getGlyphTable(chars, fontCss(S));
    chars = chars.map((c, i) => [c, t.mean[i]]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
  }
  return chars;
}
function glyphChars(S) {
  const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(String.fromCharCode(i)); return o; };
  let set;
  switch (S.glyphSet) {
    case 'alnum': set = [' ', ...range(65, 90), ...range(97, 122), ...range(48, 57)]; break;
    case 'symbols': set = Array.from(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"); break;
    case 'lines': set = Array.from(" .,'`-_=+/\\|()<>^v:;"); break;
    case 'custom': set = [' ', ...Array.from(S.glyphCustom || '')]; break;
    default: set = range(32, 126);
  }
  return Array.from(new Set(set.filter(c => c !== '\n' && c !== '\t')));
}

function sobel(L, W, H) {
  const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const ym = (y > 0 ? y - 1 : 0) * W, y0 = y * W, yp = (y < H - 1 ? y + 1 : y) * W;
    for (let x = 0; x < W; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < W - 1 ? x + 1 : x;
      const a = L[ym + xm], b = L[ym + x], c = L[ym + xp], d = L[y0 + xm], f = L[y0 + xp], g = L[yp + xm], h = L[yp + x], i = L[yp + xp];
      gx[y0 + x] = (c + 2 * f + i) - (a + 2 * d + g);
      gy[y0 + x] = (g + 2 * h + i) - (a + 2 * b + c);
    }
  }
  return { gx, gy };
}

