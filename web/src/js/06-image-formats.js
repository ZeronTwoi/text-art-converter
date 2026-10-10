/* =====================================================================
   Format sniffing + APNG / animated WEBP decoders (work in every browser:
   each frame is re-wrapped as a still PNG/WEBP that the browser decodes,
   then composited with the right blend/dispose rules).
   ===================================================================== */
function sniffFormat(h) {
  const s = (o, n) => String.fromCharCode(...h.subarray(o, o + n));
  if (s(0, 4) === 'GIF8') return 'gif';
  if (h[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (s(4, 4) === 'ftyp') { const brand = s(8, 4); return /avi[fs]|mif1|msf1/.test(brand) && !/mp4|iso|M4V|qt/.test(brand) ? 'avif' : 'video'; }
  if (h[0] === 0x1A && h[1] === 0x45 && h[2] === 0xDF && h[3] === 0xA3) return 'video';   // WEBM / MKV
  if (s(0, 4) === 'OggS') return 'video';
  if (h[0] === 0xFF && h[1] === 0xD8) return 'jpeg';
  if (s(0, 2) === 'BM') return 'bmp';
  if (h[0] === 0 && h[1] === 0 && (h[2] === 1 || h[2] === 2) && h[3] === 0) return 'ico';
  if (/^\s*(<\?xml|<svg)/i.test(s(0, Math.min(64, h.length)))) return 'svg';
  return '';
}
const SNIFF_MIME = { gif: 'image/gif', png: 'image/png', webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' };
const u32be = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
const u24le = (d, o) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16);
const u32le = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

function isAPNG(d) {
  for (let p = 8; p + 8 <= d.length;) {
    const len = u32be(d, p), type = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]);
    if (type === 'acTL') return true;
    if (type === 'IDAT') return false;
    p += 12 + len;
  }
  return false;
}
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/* -> { width, height, frames: [{ blob, x, y, w, h, delay, dispose, blend }] } */
function parseAPNG(d) {
  let ihdr = null; const shared = [], frames = []; let cur = null, seenIDAT = false;
  for (let p = 8; p + 8 <= d.length;) {
    const len = u32be(d, p), type = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]), data = d.subarray(p + 8, p + 8 + len);
    p += 12 + len;
    if (type === 'IHDR') ihdr = data;
    else if (type === 'fcTL') {
      const dn = (data[20] << 8) | data[21], dd = (data[22] << 8) | data[23] || 100;
      cur = { w: u32be(data, 4), h: u32be(data, 8), x: u32be(data, 12), y: u32be(data, 16), delay: Math.max(20, dn / dd * 1000 || 100), dispose: data[24], blend: data[25], parts: [] };
      frames.push(cur);
    } else if (type === 'IDAT') { seenIDAT = true; if (cur) cur.parts.push(data); }   // IDAT before any fcTL = hidden default image
    else if (type === 'fdAT') { if (cur) cur.parts.push(data.subarray(4)); }
    else if (type === 'IEND') break;
    else if (!seenIDAT && type !== 'acTL') shared.push(pngChunk(type, data));
  }
  if (!ihdr || !frames.length) throw new Error('Not an animated PNG');
  const W = u32be(ihdr, 0), H = u32be(ihdr, 4), sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  for (const f of frames) {
    const hd = ihdr.slice(); new DataView(hd.buffer).setUint32(0, f.w); new DataView(hd.buffer).setUint32(4, f.h);
    const total = f.parts.reduce((a, b) => a + b.length, 0), idat = new Uint8Array(total); let o = 0;
    for (const part of f.parts) { idat.set(part, o); o += part.length; }
    f.blob = new Blob([sig, pngChunk('IHDR', hd), ...shared, pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
    // APNG: blend 0 = replace region, 1 = alpha-over;  dispose 0 = keep, 1 = clear, 2 = restore previous
    f.blendOver = f.blend === 1; f.disposeMode = f.dispose === 1 ? 'clear' : f.dispose === 2 ? 'previous' : 'keep';
  }
  return { width: W, height: H, frames };
}
function isAnimatedWebP(d) { return String.fromCharCode(d[12], d[13], d[14], d[15]) === 'VP8X' && (d[20] & 0x02) !== 0; }
function parseAnimWebP(d) {
  let W = 0, H = 0; const frames = [];
  const chunk = (fourcc, data) => { const pad = data.length & 1, out = new Uint8Array(8 + data.length + pad); for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i); new DataView(out.buffer).setUint32(4, data.length, true); out.set(data, 8); return out; };
  const riff = parts => { const body = parts.reduce((a, b) => a + b.length, 0) + 4, head = new Uint8Array(12); head.set([82, 73, 70, 70], 0); new DataView(head.buffer).setUint32(4, body, true); head.set([87, 69, 66, 80], 8); return new Blob([head, ...parts], { type: 'image/webp' }); };
  for (let p = 12; p + 8 <= d.length;) {
    const id = String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]), size = u32le(d, p + 4), data = d.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
    if (id === 'VP8X') { W = 1 + u24le(data, 4); H = 1 + u24le(data, 7); }
    else if (id === 'ANMF') {
      const f = { x: 2 * u24le(data, 0), y: 2 * u24le(data, 3), w: 1 + u24le(data, 6), h: 1 + u24le(data, 9), delay: Math.max(20, u24le(data, 12) || 100), flags: data[15] };
      let alph = null, bits = null, bitsId = '';
      for (let q = 16; q + 8 <= data.length;) {
        const sid = String.fromCharCode(data[q], data[q + 1], data[q + 2], data[q + 3]), ss = u32le(data, q + 4), sd = data.subarray(q + 8, q + 8 + ss);
        q += 8 + ss + (ss & 1);
        if (sid === 'ALPH') alph = sd; else if (sid === 'VP8 ' || sid === 'VP8L') { bits = sd; bitsId = sid; }
      }
      if (!bits) continue;
      if (alph && bitsId === 'VP8 ') {
        const x = new Uint8Array(10); x[0] = 0x10; x.set([(f.w - 1) & 255, ((f.w - 1) >> 8) & 255, ((f.w - 1) >> 16) & 255, (f.h - 1) & 255, ((f.h - 1) >> 8) & 255, ((f.h - 1) >> 16) & 255], 4);
        f.blob = riff([chunk('VP8X', x), chunk('ALPH', alph), chunk('VP8 ', bits)]);
      } else f.blob = riff([chunk(bitsId, bits)]);
      f.blendOver = !(f.flags & 0x02); f.disposeMode = (f.flags & 0x01) ? 'clear' : 'keep';
      frames.push(f);
    }
  }
  if (!frames.length) throw new Error('Not an animated WEBP');
  return { width: W || frames[0].w, height: H || frames[0].h, frames };
}
/* Composites parsed frames into full-size bitmaps. */
/* composites parsed APNG / WEBP frames in order: next(i) → { bmp, delay } of the full-size frame i */
function frameCompositor(parsed) {
  const { width: W, height: H } = parsed, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  return async i => {
    const f = parsed.frames[i];
    const bmp = await createImageBitmap(f.blob);
    const saved = f.disposeMode === 'previous' ? g.getImageData(0, 0, W, H) : null;
    if (!f.blendOver) g.clearRect(f.x, f.y, f.w, f.h);
    g.drawImage(bmp, f.x, f.y); bmp.close && bmp.close();
    const out = { bmp: await createImageBitmap(c), delay: f.delay };
    if (f.disposeMode === 'clear' || (f.disposeMode === 'previous' && i === 0)) g.clearRect(f.x, f.y, f.w, f.h);
    else if (saved) g.putImageData(saved, 0, 0);
    return out;
  };
}
async function compositeFrames(parsed, onProgress) {
  const next = frameCompositor(parsed), out = [];
  for (let i = 0; i < parsed.frames.length; i++) {
    out.push(await next(i));
    if (onProgress && i % 10 === 0) { onProgress(i / parsed.frames.length); await nextTick(); }
  }
  return out;
}

