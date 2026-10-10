/* =====================================================================
   GIF decoder (handles disposal, transparency, interlace, local tables)
   ===================================================================== */
function lzwDecode(minCode, data, pixelCount) {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCode, eoi = clear + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let codeSize = minCode + 1, codeMask = (1 << codeSize) - 1, next = eoi + 1;
  let old = -1, first = 0, pos = 0, bits = 0, datum = 0, di = 0;
  while (pos < pixelCount) {
    while (bits < codeSize) { if (di >= data.length) return out; datum |= data[di++] << bits; bits += 8; }
    let code = datum & codeMask; datum >>>= codeSize; bits -= codeSize;
    if (code === clear) { codeSize = minCode + 1; codeMask = (1 << codeSize) - 1; next = eoi + 1; old = -1; continue; }
    if (code === eoi) break;
    if (old === -1) { if (code < clear) { out[pos++] = suffix[code]; old = code; first = code; } continue; }
    const inCode = code; let sp = 0;
    if (code >= next) { stack[sp++] = first; code = old; }
    while (code > eoi) { stack[sp++] = suffix[code]; code = prefix[code]; }
    first = suffix[code]; stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = old; suffix[next] = first; next++;
      if (next === codeMask + 1 && codeSize < 12) { codeSize++; codeMask = (1 << codeSize) - 1; }
    }
    old = inCode;
    while (sp > 0 && pos < pixelCount) out[pos++] = stack[--sp];
  }
  return out;
}
/* GIF decoder: { width, height, next() } where next() decodes the next frame ({ data: ImageData, delay }) or gives null. */
function gifDecoder(buffer) {
  const d = new Uint8Array(buffer);
  const sig = String.fromCharCode(d[0], d[1], d[2], d[3], d[4], d[5]);
  if (!/^GIF8[79]a$/.test(sig)) throw new Error('Not a GIF file');
  const W = d[6] | (d[7] << 8), H = d[8] | (d[9] << 8), flags = d[10];
  let p = 13, gct = null;
  if (flags & 0x80) { const n = 2 << (flags & 7); gct = d.subarray(p, p + n * 3); p += n * 3; }
  const canvas = new Uint8ClampedArray(W * H * 4);
  let gce = { delay: 0, trans: -1, disposal: 0 }, prevDisposal = 0, prevRect = null, saved = null;
  const skipBlocks = () => { while (p < d.length && d[p] !== 0) p += d[p] + 1; p++; };
  const next = () => {
   while (p < d.length) {
    const b = d[p++];
    if (b === 0x3B) break;
    if (b === 0x21) {
      const label = d[p++];
      if (label === 0xF9) {
        const size = d[p++], pf = d[p];
        gce = { disposal: (pf >> 2) & 7, trans: (pf & 1) ? d[p + 3] : -1, delay: (d[p + 1] | (d[p + 2] << 8)) * 10 };
        p += size; skipBlocks();
      } else skipBlocks();
      continue;
    }
    if (b !== 0x2C) break;
    const fx = d[p] | (d[p + 1] << 8), fy = d[p + 2] | (d[p + 3] << 8), fw = d[p + 4] | (d[p + 5] << 8), fh = d[p + 6] | (d[p + 7] << 8), f = d[p + 8];
    p += 9;
    let ct = gct;
    if (f & 0x80) { const n = 2 << (f & 7); ct = d.subarray(p, p + n * 3); p += n * 3; }
    const interlaced = !!(f & 0x40), minCode = d[p++];
    let total = 0, q = p; while (q < d.length && d[q] !== 0) { total += d[q]; q += d[q] + 1; }
    const lz = new Uint8Array(total); let o = 0;
    while (p < d.length && d[p] !== 0) { const len = d[p++]; lz.set(d.subarray(p, p + len), o); o += len; p += len; }
    p++;
    const pix = lzwDecode(minCode, lz, fw * fh);
    if (prevDisposal === 2 && prevRect) {
      const [rx, ry, rw, rh] = prevRect;
      for (let y = ry; y < Math.min(H, ry + rh); y++) canvas.fill(0, (y * W + rx) * 4, (y * W + Math.min(W, rx + rw)) * 4);
    } else if (prevDisposal === 3 && saved) canvas.set(saved);
    saved = gce.disposal === 3 ? canvas.slice() : null;
    let rowMap = null;
    if (interlaced) {
      rowMap = new Array(fh); let k = 0;
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < fh; y += step) rowMap[k++] = y;
    }
    const ctLen = ct ? ct.length / 3 : 0;
    for (let y = 0; y < fh; y++) {
      const ry = fy + (rowMap ? rowMap[y] : y); if (ry >= H) continue;
      for (let x = 0; x < fw; x++) {
        const idx = pix[y * fw + x]; if (idx === gce.trans || idx >= ctLen) continue;
        const rx = fx + x; if (rx >= W) continue;
        const oo = (ry * W + rx) * 4;
        canvas[oo] = ct[idx * 3]; canvas[oo + 1] = ct[idx * 3 + 1]; canvas[oo + 2] = ct[idx * 3 + 2]; canvas[oo + 3] = 255;
      }
    }
    const frame = { data: new ImageData(canvas.slice(), W, H), delay: gce.delay > 10 ? gce.delay : 100 };
    prevDisposal = gce.disposal; prevRect = [fx, fy, fw, fh];
    gce = { delay: 0, trans: -1, disposal: 0 };
    return frame;
   }
   return null;
  };
  return { width: W, height: H, next };
}
function decodeGIF(buffer) {
  const g = gifDecoder(buffer), frames = [];
  for (let f; (f = g.next());) frames.push(f);
  if (!frames.length) throw new Error('GIF has no frames');
  return { width: g.width, height: g.height, frames };
}
/* GIF frames decoded on a background thread, a few ahead of what is used (so memory stays small).
   decode(i) must be called for i = 0, 1, … in order; gives { bmp, delay } or null after the last frame. */
function gifWorkerDecoder(buf, width, height) {
  let worker;
  try {
    const src = `'use strict';\n${lzwDecode.toString()}\n${gifDecoder.toString()}\nlet g = null;\nonmessage = e => { if (e.data.buf) { g = gifDecoder(e.data.buf); return; } for (let k = 0; k < e.data.n; k++) { const f = g.next(); if (!f) { postMessage({ end: true }); return; } postMessage({ px: f.data.data, delay: f.delay }, [f.data.data.buffer]); } };`;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch (e) { return null; }
  const queue = [], waiting = [], AHEAD = 3;
  let asked = 0, ended = false, failed = null;
  const deliver = () => { while (waiting.length && (queue.length || ended || failed)) { const w = waiting.shift(); if (queue.length) w.res(queue.shift()); else if (failed) w.rej(failed); else w.res(null); } };
  worker.onmessage = e => { if (e.data.end) { ended = true; worker.terminate(); } else queue.push(e.data); deliver(); };
  worker.onerror = e => { e.preventDefault(); failed = new Error(e.message || 'GIF decoding failed'); worker.terminate(); deliver(); };
  worker.postMessage({ buf: buf.slice(0) });
  return {
    async decode(i) {
      if (i + AHEAD > asked && !ended && !failed) { const n = i + AHEAD - asked; asked += n; worker.postMessage({ n }); }
      const f = await new Promise((res, rej) => { waiting.push({ res, rej }); deliver(); });
      return f && { bmp: await createImageBitmap(new ImageData(f.px, width, height)), delay: f.delay };
    },
    stop() { ended = true; worker.terminate(); },
  };
}
/* frame delays of a GIF without decoding any pixels (to show and time the animation before it is decoded) */
function gifDelays(buffer) {
  const d = new Uint8Array(buffer), out = [];
  if (!/^GIF8[79]a$/.test(String.fromCharCode(d[0], d[1], d[2], d[3], d[4], d[5]))) throw new Error('Not a GIF file');
  let p = 13, delay = 0;
  if (d[10] & 0x80) p += (2 << (d[10] & 7)) * 3;
  const skipBlocks = () => { while (p < d.length && d[p] !== 0) p += d[p] + 1; p++; };
  while (p < d.length) {
    const b = d[p++];
    if (b === 0x3B) break;
    if (b === 0x21) { const label = d[p++]; if (label === 0xF9) { const size = d[p++]; delay = (d[p + 1] | (d[p + 2] << 8)) * 10; p += size; } skipBlocks(); continue; }
    if (b !== 0x2C) break;
    const f = d[p + 8]; p += 9;
    if (f & 0x80) p += (2 << (f & 7)) * 3;
    p++; skipBlocks();
    out.push(delay > 10 ? delay : 100); delay = 0;
  }
  return out;
}

