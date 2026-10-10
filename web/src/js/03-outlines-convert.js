/* =====================================================================
   Outline engine. Edges are found at 2-8x the character-grid resolution
   with a Canny detector (blur, gradients, thinning, hysteresis), then
   max-pooled down so even 1-pixel lines survive and become solid strokes.
   ===================================================================== */
const hiCanvas = newCanvas(), hiCtx = hiCanvas.getContext('2d', { willReadFrequently: true });
/* Gradients + non-maximum suppression of the high-resolution image. They depend only on the source,
   crop/turn and resolution, so the two most recent ones are kept: moving any other slider skips this.
   One pass over the rows (luma → [1 4 6 4 1]/16 blur → Sobel → ridge test) through small ring buffers, so the image is
   streamed once instead of through five full-size arrays. Same arithmetic, same float32 rounding points.
   Result: nms (full size, 0 except ridge pixels), the ridge pixels in pixel order (cand) with their
   gradients (cgx, cgy), and with full=true also full-size gradients (needed to thicken lines). */
const gradSlots = [];
/* The high-resolution image the outlines are found in (drawn on this thread: canvas resampling differs between threads). */
function hiFactor(W, H, sx) { let f = Math.max(2, Math.ceil(8 / sx)); while (f > 2 && W * f * H * f > 2.0e6) f--; return f; }
function hiPixels(src, sw, sh, S, HW, HH) {
  if (hiCanvas.width !== HW || hiCanvas.height !== HH) { hiCanvas.width = HW; hiCanvas.height = HH; }
  drawTransformed(hiCtx, src, sw, sh, HW, HH, S);
  return hiCtx.getImageData(0, 0, HW, HH).data;
}
/* The same pass as WebAssembly with SIMD (two pixels at a time): identical arithmetic and rounding, so identical results,
   about 1.5x faster. Source: the WAT port of the JavaScript below. Without WebAssembly SIMD the JavaScript runs. */
const EDGES_WASM = '@@EDGES_WASM_BASE64@@';
let edgesWasm;   // undefined: not tried yet, null: unavailable
function wasmEdges() {
  if (edgesWasm !== undefined) return edgesWasm;
  try { edgesWasm = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(atob(EDGES_WASM), c => c.charCodeAt(0))), {}).exports; } catch (e) { edgesWasm = null; }
  return edgesWasm;
}
function edgeGradients(src, sw, sh, S, HW, HH, key, full, lean, preHi) {
  for (let k = 0; k < gradSlots.length; k++) if (key && gradSlots[k].key === key) { const s = gradSlots[k]; gradSlots.splice(k, 1); gradSlots.unshift(s); return s; }
  const s = gradSlots.length < 2 ? {} : gradSlots.pop(); gradSlots.unshift(s);
  s.key = null;
  const n = HW * HH;
  if (!s.nms || s.nms.length < n) s.nms = new Float32Array(n);
  if (full && (!s.gx || s.gx.length < n)) { s.gx = new Float32Array(n); s.gy = new Float32Array(n); }
  if (!s.cand) { const c0 = Math.min(n, Math.max(n >> 3, 1024)); s.cand = new Int32Array(c0); s.cgx = new Float32Array(c0); s.cgy = new Float32Array(c0); }
  const d = preHi || hiPixels(src, sw, sh, S, HW, HH);
  const nms = s.nms, gx = full ? s.gx : null, gy = full ? s.gy : null;
  let cand = s.cand, cgx = s.cgx, cgy = s.cgy, nc = 0, maxM = 0;
  if (HW <= 2 || HH <= 2) { nms.fill(0, 0, n); if (full) { gx.fill(0, 0, n); gy.fill(0, 0, n); } s.nc = 0; s.maxM = 0; s.key = key; return s; }
  const X = !full && !globalThis.__noWasm && wasmEdges();
  if (X) {   // memory: RGBA, ridge values, ridge pixels + their gradients, 17 scratch rows
    const NMS = n * 4, CAND = NMS + n * 4, CGX = CAND + n * 4, CGY = CGX + n * 4, RING = CGY + n * 4, need = RING + 17 * HW * 4;
    if (X.mem.buffer.byteLength < need) X.mem.grow(Math.ceil((need - X.mem.buffer.byteLength) / 65536));
    new Uint8Array(X.mem.buffer, 0, n * 4).set(d.length === n * 4 ? d : d.subarray(0, n * 4));
    const nc = X.edges(0, HW, HH, NMS, CAND, CGX, CGY, RING, lean ? 1 : 0), buf = X.mem.buffer;
    nms.set(new Float32Array(buf, NMS, n));
    if (cand.length < nc) { s.cand = cand = new Int32Array(nc); s.cgx = cgx = new Float32Array(nc); s.cgy = cgy = new Float32Array(nc); }
    cand.set(new Int32Array(buf, CAND, nc)); cgx.set(new Float32Array(buf, CGX, nc)); cgy.set(new Float32Array(buf, CGY, nc));
    s.nc = nc; s.maxM = X.maxM(); s.key = key;
    return s;
  }
  const lum = scratchBuf('gLum', Float32Array, HW), tR = scratchBuf('gBlurH', Float32Array, 5 * HW), bR = scratchBuf('gBlur', Float32Array, 3 * HW);
  const mR = scratchBuf('gMag', Float32Array, 4 * HW), xR = scratchBuf('gGx', Float32Array, 2 * HW), yR = scratchBuf('gGy', Float32Array, 2 * HW);
  const ZERO = 3 * HW;   // an all-zero magnitude row stands for the border rows
  mR.fill(0, ZERO, ZERO + HW);
  let nextT = 0, nextB = 0;
  const pushT = () => {   // luma of image row nextT, blurred horizontally → tR slot
    const q = nextT++, t = (q % 5) * HW, a = lum, W = HW;
    for (let x = 0, o = q * HW * 4; x < W; x++, o += 4) a[x] = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) / 255 * (d[o + 3] / 255);
    if (W < 5) {
      for (let x = 0; x < W; x++) {
        const x1 = x > 0 ? x - 1 : 0, x2 = x > 1 ? x - 2 : x1, x3 = x < W - 1 ? x + 1 : x, x4 = x < W - 2 ? x + 2 : x3;
        tR[t + x] = (a[x2] + 4 * a[x1] + 6 * a[x] + 4 * a[x3] + a[x4]) / 16;
      }
      return;
    }
    const e = W - 1;
    tR[t] = (a[0] + 4 * a[0] + 6 * a[0] + 4 * a[1] + a[2]) / 16;
    tR[t + 1] = (a[0] + 4 * a[0] + 6 * a[1] + 4 * a[2] + a[3]) / 16;
    let p2 = a[0], p1 = a[1], p0 = a[2], n1 = a[3];
    for (let x = 2; x < e - 1; x++) { const n2 = a[x + 2]; tR[t + x] = (p2 + 4 * p1 + 6 * p0 + 4 * n1 + n2) / 16; p2 = p1; p1 = p0; p0 = n1; n1 = n2; }
    tR[t + e - 1] = (a[e - 3] + 4 * a[e - 2] + 6 * a[e - 1] + 4 * a[e] + a[e]) / 16;
    tR[t + e] = (a[e - 2] + 4 * a[e - 1] + 6 * a[e] + 4 * a[e] + a[e]) / 16;
  };
  const pushB = () => {   // vertical blur of row nextB → bR slot
    const y = nextB++;
    while (nextT <= Math.min(HH - 1, y + 2)) pushT();
    const y1 = y > 0 ? y - 1 : 0, y2 = y > 1 ? y - 2 : y1, y3 = y < HH - 1 ? y + 1 : y, y4 = y < HH - 2 ? y + 2 : y3;
    const r0 = (y % 5) * HW, r1 = (y1 % 5) * HW, r2 = (y2 % 5) * HW, r3 = (y3 % 5) * HW, r4 = (y4 % 5) * HW, b = (y % 3) * HW;
    for (let x = 0; x < HW; x++) bR[b + x] = (tR[r2 + x] + 4 * tR[r1 + x] + 6 * tR[r0 + x] + 4 * tR[r3 + x] + tR[r4 + x]) / 16;
  };
  const magRow = y => (y <= 0 || y >= HH - 1) ? ZERO : (y % 3) * HW;
  const sobel = y => {   // Sobel of row y (1..HH-2) → gradient + magnitude ring rows
    while (nextB <= y + 1) pushB();
    const u = ((y - 1) % 3) * HW, c = (y % 3) * HW, dn = ((y + 1) % 3) * HW, g = (y & 1) * HW, fo = y * HW;
    mR[c] = 0; mR[c + HW - 1] = 0;
    let mx = maxM;
    // sliding 3x3 window: X = col(x+1) - col(x-1) with col = top + 2*mid + bottom (the same sums as written out)
    let A = bR[u], B = bR[u + 1], D = bR[c], E = bR[c + 1], G = bR[dn], H = bR[dn + 1];
    let colL = A + 2 * D + G;
    for (let x = 1; x < HW - 1; x++) {
      const C = bR[u + x + 1], F = bR[c + x + 1], K = bR[dn + x + 1];
      const colR = C + 2 * F + K;
      const X = colR - colL, Y = (G + 2 * H + K) - (A + 2 * B + C);
      xR[g + x] = X; yR[g + x] = Y;
      if (full) { gx[fo + x] = X; gy[fo + x] = Y; }
      const m = Math.sqrt(X * X + Y * Y) / 4; mR[c + x] = m; if (m > mx) mx = m;
      colL = B + 2 * E + H;
      A = B; B = C; D = E; E = F; G = H; H = K;
    }
    maxM = mx;
  };
  const ridge = y => {   // non-maximum suppression of row y: keep only the ridge of each edge (1 px wide)
    const up = magRow(y - 1), c = magRow(y), dn = magRow(y + 1), g = (y & 1) * HW, fo = y * HW;
    // lean: for outline amounts 0..1 the hysteresis "low" threshold is always >= max(0.0056, 0.036 * maxM), so weaker
    // ridges can neither become edges nor move the adaptive threshold; skipping them (with a margin) changes nothing.
    const T = lean ? Math.max(0.005, 0.0055, 0.035 * maxM) : 0.005;
    nms[fo] = 0; nms[fo + HW - 1] = 0;
    for (let x = 1; x < HW - 1; x++) {
      const m = mR[c + x]; if (m < T) { nms[fo + x] = 0; continue; }
      const X = xR[g + x], Y = yR[g + x], ax = Math.abs(X), ay = Math.abs(Y);
      let n1, n2;
      if (ay <= ax * 0.4142) { n1 = mR[c + x - 1]; n2 = mR[c + x + 1]; }
      else if (ay >= ax * 2.4142) { n1 = mR[up + x]; n2 = mR[dn + x]; }
      else if (X * Y > 0) { n1 = mR[up + x - 1]; n2 = mR[dn + x + 1]; }
      else { n1 = mR[up + x + 1]; n2 = mR[dn + x - 1]; }
      if (m >= n1 && m > n2) {
        nms[fo + x] = m;
        if (nc === cand.length) {
          const len = Math.min(n, cand.length * 2), c2 = new Int32Array(len), x2 = new Float32Array(len), y2 = new Float32Array(len);
          c2.set(cand); x2.set(cgx); y2.set(cgy); cand = s.cand = c2; cgx = s.cgx = x2; cgy = s.cgy = y2;
        }
        cand[nc] = fo + x; cgx[nc] = X; cgy[nc] = Y; nc++;
      } else nms[fo + x] = 0;
    }
  };
  nms.fill(0, 0, HW); nms.fill(0, n - HW, n);
  if (full) {
    gx.fill(0, 0, HW); gy.fill(0, 0, HW); gx.fill(0, n - HW, n); gy.fill(0, n - HW, n);
    for (let y = 1; y < HH - 1; y++) { const r = y * HW; gx[r] = gy[r] = gx[r + HW - 1] = gy[r + HW - 1] = 0; }
  }
  sobel(1);
  for (let y = 1; y < HH - 1; y++) {   // the ridge test of row y needs the magnitude of row y+1
    if (y + 1 < HH - 1) sobel(y + 1);
    ridge(y);
  }
  s.nc = nc; s.maxM = maxM; s.key = key;
  return s;
}
/* Returns per grid pixel: E (0..1 edge coverage) and a structure tensor (Jxx, Jyy, Jxy) for the line direction.
   The result is shared through a cache: callers must not modify it. */
function outlineMap(src, sw, sh, S, W, H, sx, amount, preHi) {
  const f = hiFactor(W, H, sx), HW = W * f, HH = H * f, n = HW * HH;
  const full = S.outlineWidth > 1, lean = amount >= 0 && amount <= 1, sk = preHi ? null : srcKey(src);
  const gkey = sk && `${sk}|${transformSig(S)}|${HW}x${HH}${full ? '|full' : ''}${lean ? '' : '|all'}`;
  const okey = gkey && `${gkey}|${W}x${H}|${amount}|${S.outlineWidth}`;
  const hit = okey && outlineCache.get(okey);
  if (hit) return hit;
  const G = edgeGradients(src, sw, sh, S, HW, HH, gkey, full, lean, preHi), { gx, gy, cgx, cgy, nms, cand, nc, maxM } = G;
  // adaptive thresholds: "amount" decides how many edge pixels are kept
  const hist = new Uint32Array(512), scale = maxM > 0 ? 511 / maxM : 0;
  for (let k = 0; k < nc; k++) hist[Math.min(511, (nms[cand[k]] * scale) | 0)]++;
  const target = n * (0.006 + 0.06 * amount);
  let acc = 0, hb = 511;
  for (; hb > 0; hb--) { acc += hist[hb]; if (acc >= target) break; }
  // ignore soft gradients: an edge must also be reasonably strong compared with the strongest edge in the image
  const high = Math.max(scale ? hb / scale : 1, 0.035 * (1.4 - amount), maxM * 0.3 * (1 - amount * 0.7)), low = high * 0.4;
  // hysteresis: strong edges, extended along connected weaker ones (only ridge pixels can ever be edges)
  let e = scratchBuf('edge', Uint8Array, n); e.fill(0);
  const st = scratchBuf('stack', Int32Array, Math.max(1, nc)); let sp = 0;
  for (let k = 0; k < nc; k++) { const i = cand[k]; if (nms[i] >= high) { e[i] = 1; st[sp++] = i; } }
  while (sp) {
    const i = st[--sp], x = i % HW;
    for (let dy = -HW; dy <= HW; dy += HW) for (let dx = -1; dx <= 1; dx++) {
      if ((dx === -1 && x === 0) || (dx === 1 && x === HW - 1)) continue;
      const j = i + dy + dx; if (j < 0 || j >= n || e[j] || nms[j] < low) continue;
      e[j] = 1; st[sp++] = j;
    }
  }
  const E = new Float32Array(W * H), Jxx = new Float32Array(W * H), Jyy = new Float32Array(W * H), Jxy = new Float32Array(W * H);
  const pool = (i, X, Y) => {
    const hy = (i / HW) | 0, hx = i - hy * HW, si = ((hy / f) | 0) * W + ((hx / f) | 0);
    E[si]++; Jxx[si] += X * X; Jyy[si] += Y * Y; Jxy[si] += X * Y;
  };
  if (full) {   // thicker lines, then max-pool every edge pixel to the character grid
    let e2 = scratchBuf('edge2', Uint8Array, n);
    for (let t = 1; t < S.outlineWidth; t++) {
      e2.set(e);
      for (let y = 1; y < HH - 1; y++) for (let x = 1; x < HW - 1; x++) { const i = y * HW + x; if (e[i]) { e2[i - 1] = e2[i + 1] = e2[i - HW] = e2[i + HW] = 1; } }
      const tmp = e; e = e2; e2 = tmp;
    }
    for (let i = 0; i < n; i++) if (e[i]) pool(i, gx[i], gy[i]);
  } else for (let k = 0; k < nc; k++) { const i = cand[k]; if (e[i]) pool(i, cgx[k], cgy[k]); }   // candidates are in pixel order
  for (let i = 0; i < E.length; i++) E[i] = Math.min(1, E[i] / f);
  const res = { E, Jxx, Jyy, Jxy };
  if (okey) outlineCache.set(okey, res, W * H * 16);
  return res;
}
/* Line direction character from the structure tensor (robust: opposite gradients don't cancel). */
/* pa = height/width of one grid pixel on screen (cells are tall). Picks the glyph whose on-screen slant is closest. */
function dirCharCp(jxx, jyy, jxy, pa, charAspect) {
  const yy = jyy / (pa * pa), xy = jxy / pa;                       // tensor in true screen geometry
  const phi = 0.5 * Math.atan2(2 * xy, jxx - yy);
  const d = ((phi * 180 / Math.PI + 90) % 180 + 180) % 180;         // line angle, y pointing down
  const g = Math.atan(charAspect) * 180 / Math.PI;                  // slant of \ and / inside a cell
  const opts = [[0, 45], [g, 92], [90, 124], [180 - g, 47], [180, 45]];   // - \ | / -
  let best = 45, bd = 1e9; for (const [a, c] of opts) { const dd = Math.abs(d - a); if (dd < bd) { bd = dd; best = c; } }
  return best;
}
/* Local mean / standard deviation in a (2r+1)² window, via integral images. */
function localStats(L, W, H, r) {
  const W1 = W + 1, I = new Float64Array(W1 * (H + 1)), I2 = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let s = 0, s2 = 0;
    for (let x = 0; x < W; x++) { const v = L[y * W + x]; s += v; s2 += v * v; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + s; I2[(y + 1) * W1 + x + 1] = I2[y * W1 + x + 1] + s2; }
  }
  const mean = new Float32Array(W * H), sd = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), area = (y1 - y0) * (x1 - x0);
      const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      const s2 = I2[y1 * W1 + x1] - I2[y0 * W1 + x1] - I2[y1 * W1 + x0] + I2[y0 * W1 + x0];
      const m = s / area; mean[y * W + x] = m; sd[y * W + x] = Math.sqrt(Math.max(0, s2 / area - m * m));
    }
  }
  return { mean, sd };
}
/* Background = the plain area connected to the image border (flood fill from the edges). 1 = background. */
function backgroundMask(C, A, W, H) {
  const keyOf = i => A[i] < 0.5 ? -1 : ((C[i * 3] >> 5) << 6) | ((C[i * 3 + 1] >> 5) << 3) | (C[i * 3 + 2] >> 5);
  const border = [], hist = new Map(); let bestK = 0, bestN = 0;
  const add = i => { border.push(i); const k = keyOf(i), c = (hist.get(k) || 0) + 1; hist.set(k, c); if (c > bestN) { bestN = c; bestK = k; } };
  for (let x = 0; x < W; x++) { add(x); add((H - 1) * W + x); }
  for (let y = 1; y < H - 1; y++) { add(y * W); add(y * W + W - 1); }
  if (bestN < border.length * 0.3) return null;   // no clear plain background
  let r = 0, g = 0, b = 0, c = 0;
  for (const i of border) if (keyOf(i) === bestK) { r += C[i * 3]; g += C[i * 3 + 1]; b += C[i * 3 + 2]; c++; }
  r /= c; g /= c; b /= c;
  const near = i => A[i] < 0.5 || (bestK !== -1 && Math.abs(C[i * 3] - r) + Math.abs(C[i * 3 + 1] - g) + Math.abs(C[i * 3 + 2] - b) < 70);
  const m = new Uint8Array(W * H), st = [];
  for (const i of border) if (!m[i] && near(i)) { m[i] = 1; st.push(i); }
  while (st.length) {
    const i = st.pop(), x = i % W;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && !m[j] && near(j)) { m[j] = 1; st.push(j); }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) { s += m[yy * W + xx]; k++; } }
    out[y * W + x] = s / k;
  }
  return out;
}

/* Settings that only change how a result is drawn or exported, not the result itself. */
const RENDER_ONLY_KEYS = new Set(['captionTop', 'captionBottom', 'captionStyle', 'captionBox', 'captionColor', 'fontSize', 'margin', 'renderStyle', 'dotShape', 'dotSize', 'platform', 'shareOptimize', 'shareTarget', 'shareSplit', 'shareColor', 'shareTheme', 'calib', 'exportGoal', 'exportScale', 'quality', 'gifFps', 'frameStep', 'gifColors', 'gifDiff', 'gifDither', 'gifPalette', 'videoFps', 'videoBitrate', 'includeAudio', 'animRepeat']);
const CONVERT_KEYS = Object.keys(DEFAULTS).filter(k => !RENDER_ONLY_KEYS.has(k));
const resultBytes = r => r.cp.byteLength + r.fg.byteLength + (r.bgc ? r.bgc.byteLength : 0) + (r.bits ? r.bits.byteLength : 0) + (r.val ? r.val.byteLength : 0) + (r.ov ? r.ov.byteLength : 0) + 200;
/* Main conversion: drawable → result grid. Results of immutable sources are memoised (callers never modify a result),
   so replaying an animation, redrawing at another size or switching views costs no conversion at all. */
const convertSig = S => JSON.stringify(CONVERT_KEYS.map(k => S[k]));
/* memo key of a conversion (null: the source can change, nothing is memoised) */
function memoKey(src, sw, sh, S, sig) {
  const sk = srcKey(src); if (!sk) return null;
  const m = maskFor(src);
  return sk + '|' + sw + 'x' + sh + '|' + (sig || convertSig(S)) + (m ? '|mask' + m.ver : '');
}
/* ---- painted mask: where the picture is hidden (red) or kept safe from "Hide plain background" (green) ----
   Painted in source coordinates, so crop, turn and flip apply to it like to the picture. */
const Mask = { canvas: null, ver: 0, src: null, cache: new Map(), on: false, brush: 'hide', size: 6, pending: false };
function maskFor(src) { return Mask.ver && Mask.src && src && srcOwner.get(src) === Mask.src ? Mask : null; }
function maskEnsure() {
  const s = App.src;
  if (Mask.canvas && Mask.src === s) return Mask;
  const k = Math.min(1, 1024 / Math.max(s.w, s.h));
  Mask.canvas = newCanvas(Math.max(1, Math.round(s.w * k)), Math.max(1, Math.round(s.h * k)));
  Mask.src = s; Mask.ver = 0; Mask.cache.clear();
  return Mask;
}
function maskClear() { Mask.canvas = null; Mask.src = null; Mask.ver = 0; Mask.cache.clear(); }
const maskCanvas = newCanvas(), maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
/* the mask at the character grid (W×H RGBA: R = hide, G = keep, A = strength), or null */
function maskPixels(src, S, W, H) {
  const m = maskFor(src); if (!m) return null;
  const key = m.ver + '|' + transformSig(S) + '|' + W + 'x' + H;
  let px = m.cache.get(key);
  if (!px) {
    if (maskCanvas.width !== W || maskCanvas.height !== H) { maskCanvas.width = W; maskCanvas.height = H; }
    drawTransformed(maskCtx, m.canvas, m.canvas.width, m.canvas.height, W, H, S);
    px = maskCtx.getImageData(0, 0, W, H).data;
    if (m.cache.size > 12) m.cache.clear();
    m.cache.set(key, px);
  }
  return px;
}
/* the result as shown and saved: the conversion plus captions and hand edits (see overlay) */
function convert(src, sw, sh, S) { return withOverlay(convertRaw(src, sw, sh, S), S); }
function convertRaw(src, sw, sh, S) {
  const key = memoKey(src, sw, sh, S);
  if (!key) return convertCore(src, sw, sh, S, null);
  let r = resultCache.get(key);
  if (!r) { r = convertCore(src, sw, sh, S, srcKey(src)); resultCache.set(key, r, resultBytes(r)); }
  return r;
}
/* an already computed conversion (without overlay), or undefined (never converts) */
function peekResult(src, sw, sh, S) { const key = memoKey(src, sw, sh, S); return key ? resultCache.get(key) : undefined; }
/* The source resampled to the character grid (cached for immutable sources). */
function samplePixels(src, sw, sh, S, W, H, sk) {
  const skey = sk && `${sk}|${transformSig(S)}|${W}x${H}`;
  let data = skey && sampleCache.get(skey);
  if (!data) {
    const cv = work.sample;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    drawTransformed(sctx, src, sw, sh, W, H, S);
    data = sctx.getImageData(0, 0, W, H).data;
    if (skey) sampleCache.set(skey, data, data.length);
  }
  return data;
}
const outlineAmount = S => S.mode === 'edge' ? Math.max(S.outline, 0.35) : S.outline;
/* Everything convert needs from the canvas, drawn on this thread, so the rest can run on a worker:
   convertCore(null, sw, sh, S, null, convertInputs(...)) gives exactly the result of convert.
   The arrays may be shared with the caches: copy them to a worker, never transfer them. */
function convertInputs(src, sw, sh, S) {
  const sk = srcKey(src), { W, H, sx } = gridFor(sw, sh, S), sample = samplePixels(src, sw, sh, S, W, H, sk), mask = maskPixels(src, S, W, H);
  if (!(outlineAmount(S) > 0)) return { sample, hi: null, mask };
  const f = hiFactor(W, H, sx), HW = W * f, HH = H * f, key = sk && `${sk}|${transformSig(S)}|hi${HW}x${HH}`;
  let hi = key && sampleCache.get(key);
  if (!hi) { hi = hiPixels(src, sw, sh, S, HW, HH); if (key) sampleCache.set(key, hi, hi.length); }
  return { sample, hi, mask };
}
function convertCore(src, sw, sh, S, sk, pre) {
  const mode = S.mode, m = MODES[mode];
  const { cols, rows, sx, sy, W, H } = gridFor(sw, sh, S);
  const data = pre ? pre.sample : samplePixels(src, sw, sh, S, W, H, sk);
  const N = W * H;
  const L = scratchBuf('L', Float32Array, N), A = scratchBuf('A', Float32Array, N), C = scratchBuf('C', Uint8ClampedArray, N * 3);
  const c0 = clamp(S.contrast, -1, 0.98), cf = (1 + c0) / (1 - c0), br = S.brightness, sat = S.saturation, ig = 1 / clamp(S.gamma, 0.05, 10);
  if (sat === 1) {   // channels are independent: tone curve as a 256-entry table (same arithmetic, no pow per pixel)
    const LF = new Float64Array(256), LB = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let r = v / 255; r = (r - 0.5) * cf + 0.5 + br; r = r < 0 ? 0 : r > 1 ? 1 : r;
      if (ig !== 1) r = Math.pow(r, ig);
      LF[v] = r; LB[v] = r * 255;
    }
    for (let i = 0, o = 0, k = 0; i < N; i++, o += 4, k += 3) {
      const R = data[o], G = data[o + 1], B = data[o + 2];
      L[i] = 0.299 * LF[R] + 0.587 * LF[G] + 0.114 * LF[B];
      C[k] = LB[R]; C[k + 1] = LB[G]; C[k + 2] = LB[B];
      A[i] = data[o + 3] / 255;
    }
  } else for (let i = 0; i < N; i++) {
    const o = i * 4;
    let r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
    r = (r - 0.5) * cf + 0.5 + br; g = (g - 0.5) * cf + 0.5 + br; b = (b - 0.5) * cf + 0.5 + br;
    { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
    r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
    if (ig !== 1) { r = Math.pow(r, ig); g = Math.pow(g, ig); b = Math.pow(b, ig); }
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    C[i * 3] = r * 255; C[i * 3 + 1] = g * 255; C[i * 3 + 2] = b * 255;
    A[i] = data[o + 3] / 255;
  }
  if (S.autoLevels) {
    const hist = new Uint32Array(256); let cnt = 0;
    for (let i = 0; i < N; i++) if (A[i] > 0.5) { hist[(L[i] * 255) | 0]++; cnt++; }
    let lo = 0, hi = 255, acc = 0;
    for (; lo < 255; lo++) { acc += hist[lo]; if (acc > cnt * 0.01) break; }
    acc = 0; for (; hi > 0; hi--) { acc += hist[hi]; if (acc > cnt * 0.01) break; }
    if (hi - lo > 4) { const a = lo / 255, s = 255 / (hi - lo); for (let i = 0; i < N; i++) L[i] = clamp((L[i] - a) * s, 0, 1); }
  }
  if (S.sharpen > 0 && W > 2 && H > 2) {
    const B = new Float32Array(N), k = S.sharpen;
    for (let y = 0; y < H; y++) {
      const ym = (y > 0 ? y - 1 : 0) * W, y0 = y * W, yp = (y < H - 1 ? y + 1 : y) * W;
      for (let x = 0; x < W; x++) {
        const xm = x > 0 ? x - 1 : 0, xp = x < W - 1 ? x + 1 : x;
        B[y0 + x] = (L[ym + xm] + L[ym + x] + L[ym + xp] + L[y0 + xm] + L[y0 + x] + L[y0 + xp] + L[yp + xm] + L[yp + x] + L[yp + xp]) / 9;
      }
    }
    for (let i = 0; i < N; i++) L[i] = clamp(L[i] + k * (L[i] - B[i]), 0, 1);
  }
  // local contrast ("depth"): compare each pixel with its neighbourhood so forms separate even in flat light
  if (S.localContrast > 0 && W > 4 && H > 4) {
    const { mean, sd } = localStats(L, W, H, Math.max(2, Math.round(Math.min(W, H) / 10))), k = S.localContrast;
    for (let i = 0; i < N; i++) { const v = clamp(0.5 + (L[i] - mean[i]) / (2.2 * sd[i] + 0.06) * 0.5, 0, 1); L[i] += (v - L[i]) * k; }
  }
  const FG = hexToRgb(S.fg), BG = hexToRgb(S.bg), GA = hexToRgb(S.gradA), GB = hexToRgb(S.gradB);
  const CM = S.colorMode;
  // "ink" = how much character should be drawn. Bright pixels get ink on a dark background and vice versa.
  const inkFromLum = CM === 'mono' ? lumRGB(BG) <= lumRGB(FG) : lumRGB(BG) < 0.5;
  const ink = scratchBuf('ink', Float32Array, N);
  for (let i = 0; i < N; i++) {
    let v = inkFromLum ? L[i] : 1 - L[i];
    if (S.invert) v = 1 - v;
    ink[i] = v * A[i];
  }
  if (S.edge > 0) {
    const grad = sobel(L, W, H), e = S.edge;
    for (let i = 0; i < N; i++) {
      const mag = Math.min(1, Math.sqrt(grad.gx[i] * grad.gx[i] + grad.gy[i] * grad.gy[i]) / 2.5);
      ink[i] = clamp(ink[i] * (1 - e) + mag * e * 1.4 * A[i], 0, 1);
    }
  }
  // background fade + shading amount
  const bgm = S.bgFade > 0 ? backgroundMask(C, A, W, H) : null;
  const MK = pre ? pre.mask : maskPixels(src, S, W, H);   // painted mask: R = hide, G = keep (A = strength)
  const hideAt = i => MK[i * 4] * MK[i * 4 + 3] / 65025, keepAt = i => MK[i * 4 + 1] * MK[i * 4 + 3] / 65025;
  if (bgm && MK) for (let i = 0; i < N; i++) ink[i] *= 1 - S.bgFade * bgm[i] * (1 - keepAt(i));
  else if (bgm) for (let i = 0; i < N; i++) ink[i] *= 1 - S.bgFade * bgm[i];
  if (MK) for (let i = 0; i < N; i++) { const h = hideAt(i); if (h) ink[i] *= 1 - h; }
  if (S.fill !== 1) for (let i = 0; i < N; i++) ink[i] *= S.fill;
  // outlines (solid strokes drawn on top of the shading)
  const olAmt = outlineAmount(S);
  let OL = olAmt > 0 ? outlineMap(src, sw, sh, S, W, H, sx, olAmt, pre && pre.hi) : null;
  if (OL && (bgm || MK)) {   // the outline map is shared (cached): fade a copy
    const E = OL.E.slice();
    if (bgm && MK) for (let i = 0; i < N; i++) E[i] *= 1 - S.bgFade * bgm[i] * (1 - keepAt(i));
    else if (bgm) for (let i = 0; i < N; i++) E[i] *= 1 - S.bgFade * bgm[i];
    if (MK) for (let i = 0; i < N; i++) { const h = hideAt(i); if (h) E[i] *= 1 - h; }
    OL = { E, Jxx: OL.Jxx, Jyy: OL.Jyy, Jxy: OL.Jxy };
  }
  const EDGE_ON = 0.22;
  const addEdges = q => { if (OL) for (let i = 0; i < N; i++) if (OL.E[i] > EDGE_ON) q[i] = 1; return q; };

  const n = cols * rows;
  const res = { cols, rows, mode, cp: new Uint32Array(n), fg: new Uint8ClampedArray(n * 3), bgc: null, bits: null, val: null, uniform: CM === 'mono' };
  const fg = res.fg, cp = res.cp;
  const acc = [0, 0, 0];
  // average colour of a cell (optionally only "on" sub-pixels)
  function cellAvg(cx, cy, q) {
    let r = 0, g = 0, b = 0, w = 0, r2 = 0, g2 = 0, b2 = 0, w2 = 0;
    for (let dy = 0; dy < sy; dy++) {
      let i = (cy * sy + dy) * W + cx * sx;
      for (let dx = 0; dx < sx; dx++, i++) {
        const a = A[i] + 1e-4, o = i * 3;
        r += C[o] * a; g += C[o + 1] * a; b += C[o + 2] * a; w += a;
        if (q && q[i]) { r2 += C[o] * a; g2 += C[o + 1] * a; b2 += C[o + 2] * a; w2 += a; }
      }
    }
    if (w2 > 0) { acc[0] = r2 / w2; acc[1] = g2 / w2; acc[2] = b2 / w2; } else { acc[0] = r / w; acc[1] = g / w; acc[2] = b / w; }
    return acc;
  }
  function paint(arr, c, r, g, b) {
    const o = c * 3;
    if (CM === 'color') { arr[o] = r; arr[o + 1] = g; arr[o + 2] = b; }
    else if (CM === 'gray') { const l = 0.299 * r + 0.587 * g + 0.114 * b; arr[o] = arr[o + 1] = arr[o + 2] = l; }
    else if (CM === 'gradient') { const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255; arr[o] = GA[0] + (GB[0] - GA[0]) * l; arr[o + 1] = GA[1] + (GB[1] - GA[1]) * l; arr[o + 2] = GA[2] + (GB[2] - GA[2]) * l; }
    else if (CM === 'app') { const c = appColour(S.appPalette, r, g, b); arr[o] = c[0]; arr[o + 1] = c[1]; arr[o + 2] = c[2]; }
    else { arr[o] = FG[0]; arr[o + 1] = FG[1]; arr[o + 2] = FG[2]; }
  }
  const needColor = CM !== 'mono';

  if (mode === 'braille' || mode === 'quad') {
    const q = addEdges(quantizeGrid(ink, W, H, 2, S.dither, S.threshold));
    const bits = res.bits = new Uint8Array(n);
    const blank = S.brailleBlank === 'space' ? 32 : 0x2800;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx; let bt = 0;
      if (mode === 'braille') {
        for (let dy = 0; dy < 4; dy++) { const i = (cy * 4 + dy) * W + cx * 2; if (q[i]) bt |= BRAILLE_BIT[dy][0]; if (q[i + 1]) bt |= BRAILLE_BIT[dy][1]; }
        cp[c] = bt ? 0x2800 + bt : blank;
      } else {
        const i = cy * 2 * W + cx * 2;
        bt = (q[i] ? 1 : 0) | (q[i + 1] ? 2 : 0) | (q[i + W] ? 4 : 0) | (q[i + W + 1] ? 8 : 0);
        cp[c] = QUAD_CHARS[bt].codePointAt(0);
      }
      bits[c] = bt;
      if (needColor) { const a = cellAvg(cx, cy, q); paint(fg, c, a[0], a[1], a[2]); } else paint(fg, c, 0, 0, 0);
    }
  } else if (mode === 'half') {
    const bits = res.bits = new Uint8Array(n);
    if (needColor) {
      if (OL) for (let i = 0; i < N; i++) {   // outlines darken the colour pixels, like ink lines in a comic
        const e = Math.min(1, OL.E[i] * 1.5) * 0.75; if (e <= 0) continue;
        for (let k = 0; k < 3; k++) C[i * 3 + k] *= 1 - e;
      }
      if (MK) for (let i = 0; i < N; i++) { const h = hideAt(i); if (h) for (let k = 0; k < 3; k++) C[i * 3 + k] += (BG[k] - C[i * 3 + k]) * h; }   // hidden: background colour
      res.bgc = new Uint8ClampedArray(n * 3);
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const c = cy * cols + cx, it = (cy * 2) * W + cx, ib = it + W;
        paint(fg, c, C[it * 3], C[it * 3 + 1], C[it * 3 + 2]);
        paint(res.bgc, c, C[ib * 3], C[ib * 3 + 1], C[ib * 3 + 2]);
        cp[c] = 0x2580; bits[c] = 1;
      }
    } else {
      const q = addEdges(quantizeGrid(ink, W, H, 2, S.dither, S.threshold));
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const c = cy * cols + cx, it = (cy * 2) * W + cx;
        const bt = (q[it] ? 1 : 0) | (q[it + W] ? 2 : 0);
        bits[c] = bt; cp[c] = HALF_CHARS[bt].codePointAt(0); paint(fg, c, 0, 0, 0);
      }
    }
  } else if (mode === 'ascii' || mode === 'halftone') {
    let ramp = mode === 'ascii' ? getRamp(S) : HALFTONE_RAMP;
    // with direction outlines, keep line characters for real edges only so shading never looks like a stray line
    if (mode === 'ascii' && OL && S.outlineDir) { const r2 = ramp.filter(ch => !'-|/\_'.includes(ch)); if (r2.length >= 2) ramp = r2; }
    const rcp = ramp.map(ch => ch.codePointAt(0));
    const q = quantizeGrid(ink, W, H, ramp.length, S.dither, S.threshold);
    if (mode === 'halftone') res.val = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const edge = OL && OL.E[c] > EDGE_ON;
      if (edge && mode === 'ascii') cp[c] = S.outlineDir ? dirCharCp(OL.Jxx[c], OL.Jyy[c], OL.Jxy[c], S.charAspect * sx / sy, S.charAspect) : rcp[rcp.length - 1];
      else cp[c] = edge ? rcp[rcp.length - 1] : rcp[q[c]];
      if (res.val) res.val[c] = Math.max(clamp(ink[c] + 0.5 - S.threshold, 0, 1), edge ? Math.min(1, 0.45 + OL.E[c]) : 0);
      if (needColor) { const o = c * 3; paint(fg, c, C[o], C[o + 1], C[o + 2]); } else paint(fg, c, 0, 0, 0);
    }
  } else if (mode === 'glyph') {
    const T = getGlyphTable(glyphChars(S), fontCss(S)), G = T.vecs, nG = T.chars.length;
    const gcp = T.chars.map(ch => ch.codePointAt(0));
    const vec = new Float32Array(32), bias = 0.5 - S.threshold;
    const { ord, ordSum } = glyphOrder(T);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      let k = 0;
      for (let dy = 0; dy < 8; dy++) {
        let i = (cy * 8 + dy) * W + cx * 4;
        for (let dx = 0; dx < 4; dx++, i++) vec[k++] = OL ? Math.max(ink[i] + bias, Math.min(1, OL.E[i] * 1.6)) : ink[i] + bias;
      }
      // nearest glyph (lowest index on ties). Glyphs are visited by |sum(cell) - sum(glyph)|, whose square / 32
      // is a lower bound of the distance (Cauchy-Schwarz), so the search stops as soon as nothing can beat the best.
      let sv = 0; for (let j = 0; j < 32; j++) sv += vec[j];
      let lo = 0, hi = nG;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (ordSum[mid] < sv) lo = mid + 1; else hi = mid; }
      let left = lo - 1, right = lo, best = -1, bd = Infinity;
      while (left >= 0 || right < nG) {
        const dl = left >= 0 ? sv - ordSum[left] : Infinity, dr = right < nG ? ordSum[right] - sv : Infinity;
        let pos, diff;
        if (dl <= dr) { pos = left--; diff = dl; } else { pos = right++; diff = dr; }
        if (diff * diff / 32 > bd * (1 + 1e-9) + 1e-12) break;
        const g = ord[pos], o = g * 32;
        let d = 0;
        for (let j = 0; j < 32; j++) { const e = vec[j] - G[o + j]; d += e * e; if (d > bd) break; }
        if (d < bd || (d === bd && g < best)) { bd = d; best = g; }
      }
      if (best < 0) best = 0;
      const c = cy * cols + cx; cp[c] = gcp[best];
      if (needColor) { const a = cellAvg(cx, cy, null); paint(fg, c, a[0], a[1], a[2]); } else paint(fg, c, 0, 0, 0);
    }
  } else if (mode === 'edge') {
    const ramp = getRamp(S).map(ch => ch.codePointAt(0)), nr = ramp.length - 1;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      let e = 0, jxx = 0, jyy = 0, jxy = 0, si = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = (cy * 2 + dy) * W + cx * 2 + dx;
        e = Math.max(e, OL.E[i]); jxx += OL.Jxx[i]; jyy += OL.Jyy[i]; jxy += OL.Jxy[i]; si += ink[i];
      }
      const c = cy * cols + cx;
      if (e > EDGE_ON) cp[c] = dirCharCp(jxx, jyy, jxy, S.charAspect * sx / sy, S.charAspect);
      else if (S.edgeFill) cp[c] = ramp[clamp(Math.round((si / 4 + 0.5 - S.threshold) * nr), 0, nr)];
      else cp[c] = 32;
      if (needColor) { const a = cellAvg(cx, cy, null); paint(fg, c, a[0], a[1], a[2]); } else paint(fg, c, 0, 0, 0);
    }
  } else if (mode === 'word') {
    let chars = Array.from(S.wordText || '');
    if (!S.wordFillAll) chars = chars.filter(ch => !/\s/.test(ch));
    chars = chars.filter(ch => ch !== '\n' && ch !== '\r' && ch !== '\t');
    if (!chars.length) chars = ['#'];
    const wcp = chars.map(ch => ch.codePointAt(0));
    const q = S.wordFillAll ? null : addEdges(quantizeGrid(ink, W, H, 2, S.dither, S.threshold));
    let k = 0;
    for (let c = 0; c < n; c++) {
      if (!q || q[c]) { cp[c] = wcp[k % wcp.length]; k++; } else cp[c] = 32;
      if (needColor) { const o = c * 3; paint(fg, c, C[o], C[o + 1], C[o + 2]); } else paint(fg, c, 0, 0, 0);
    }
  }

  if (S.bgMode === 'cell' && !res.bgc) {
    const bgc = res.bgc = new Uint8ClampedArray(n * 3);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      const a = cellAvg(cx, cy, null), o = (cy * cols + cx) * 3;
      bgc[o] = BG[0] + (a[0] - BG[0]) * 0.38; bgc[o + 1] = BG[1] + (a[1] - BG[1]) * 0.38; bgc[o + 2] = BG[2] + (a[2] - BG[2]) * 0.38;
    }
  }
  if (res.bgc || mode === 'half' && needColor) res.uniform = false;
  return res;
}

/* Text art typed/pasted by the user → result grid (ansi: colours of an imported ANSI file, see ansiParse) */
function textResult(text, S, ansi) { return withOverlay(textResultRaw(text, S, ansi), S); }
function textResultRaw(text, S, ansi) {
  if (ansi) return ansiResult(ansi, S);
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const arr = lines.map(l => Array.from(l));
  const cols = Math.max(1, arr.reduce((m, a) => Math.max(m, a.length), 0)), rows = Math.max(1, arr.length);
  const n = cols * rows, res = { cols, rows, mode: 'text', cp: new Uint32Array(n).fill(32), fg: new Uint8ClampedArray(n * 3), bgc: null, bits: null, val: null, uniform: S.colorMode !== 'gradient' };
  const FG = hexToRgb(S.fg), GA = hexToRgb(S.gradA), GB = hexToRgb(S.gradB);
  const dir = S.textGradient === 'horizontal' ? 1 : S.textGradient === 'diagonal' ? 2 : 0;
  for (let y = 0; y < rows; y++) {
    const ty = rows > 1 ? y / (rows - 1) : 0;
    for (let x = 0; x < cols; x++) {
      const c = y * cols + x, tx = cols > 1 ? x / (cols - 1) : 0, t = dir === 0 ? ty : dir === 1 ? tx : (tx + ty) / 2;
      const col = S.colorMode === 'gradient' ? [GB[0] + (GA[0] - GB[0]) * t, GB[1] + (GA[1] - GB[1]) * t, GB[2] + (GA[2] - GB[2]) * t] : FG;
      if (arr[y] && x < arr[y].length) res.cp[c] = arr[y][x].codePointAt(0);
      res.fg[c * 3] = col[0]; res.fg[c * 3 + 1] = col[1]; res.fg[c * 3 + 2] = col[2];
    }
  }
  return res;
}

