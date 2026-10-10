/* =====================================================================
   Before → after video: the original picture turns into the text art (a wipe across it, or a fade).
   A still picture gets a few seconds; an animation or video plays while the wipe crosses it.
   ===================================================================== */
/* encodes canvases as MP4 / WEBM (VideoEncoder) or GIF; add(canvas, delayMs), then finish() → Blob */
async function videoWriter(fmt, W, H, fps) {
  if (fmt === 'gif') {
    const enc = new GifEncoder(W, H, 0);
    return {
      add(c, delay) { const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data; enc.addFrameBytes(gifFrameBytes(px, 256, false, Math.max(2, Math.round(delay / 10)), 1, W, H)); },
      async finish() { return new Blob([enc.finish()], { type: 'image/gif' }); },
    };
  }
  const cfg = await pickVideoCodec(fmt, W, H, Math.round(S.videoBitrate * 1e6), fps);
  if (!cfg) throw new Error(`this browser cannot make ${fmt.toUpperCase()} videos at ${W}×${H}`);
  const chunks = []; let err = null, t = 0, avcC = null, lastKey = -1e9;
  const enc = new VideoEncoder({ output: (ch, meta) => { const data = new Uint8Array(ch.byteLength); ch.copyTo(data); chunks.push({ data, t: ch.timestamp / 1000, key: ch.type === 'key' }); const d = meta && meta.decoderConfig && meta.decoderConfig.description; if (d) avcC = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d).slice(); }, error: e => { err = e; } });
  enc.configure(cfg);
  return {
    async add(c, delay) {
      while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
      if (err) throw err;
      const key = t - lastKey >= 2000; if (key) lastKey = t;
      const vf = new VideoFrame(c, { timestamp: Math.round(t * 1000), duration: Math.round(delay * 1000) }); enc.encode(vf, { keyFrame: key }); vf.close(); t += delay;
    },
    async finish() {
      await enc.flush(); enc.close(); if (err) throw err;
      chunks.sort((a, b) => a.t - b.t);
      return fmt === 'mp4' ? mp4File(cfg.width, cfg.height, avcC, chunks, t) : webmFile(cfg.width, cfg.height, cfg.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', chunks, t);
    },
  };
}
/* the original as a picture of the same size and margins as the art */
function drawOriginalLike(g, d, W, H, scale) {
  const [, , mx, my] = pictureSize(0, 0, S, scale), iw = Math.max(1, W - 2 * mx), ih = Math.max(1, H - 2 * my);
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = S.bgMode === 'transparent' ? '#000' : S.bg; g.fillRect(0, 0, W, H);
  const t = drawOriginalLike.t || (drawOriginalLike.t = document.createElement('canvas'));
  if (t.width !== iw || t.height !== ih) { t.width = iw; t.height = ih; }
  drawTransformed(t.getContext('2d'), d[0], d[1], d[2], iw, ih, S);
  g.drawImage(t, mx, my);
}
const smooth01 = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
async function exportReveal(fmt = 'mp4', secs = 4, style = 'wipe') {
  if (!requireRes()) return;
  const s = App.src; if (s.kind === 'text') return toast('A before → after video needs a picture, not text');
  await runExport('Making the before → after video', async progress => {
    const moving = s.kind === 'anim' || s.kind === 'video', fps = fmt === 'gif' ? 15 : 30;
    // the frames: a still repeats; an animation / video plays (at most 12 s)
    const items = [];
    if (!moving) { const d = currentDrawable(); const n = Math.round(clamp(secs, 1, 10) * fps); for (let i = 0; i < n; i++) items.push({ d, res: App.res, delay: 1000 / fps }); }
    else {
      let total = 0;
      for await (const f of exportFrames(s, fps)) {
        if (App.cancel) throw cancelled();
        const snap = f.d instanceof HTMLVideoElement ? await createImageBitmap(f.d) : f.d;
        items.push({ d: [snap, f.w, f.h], res: frameResult(f), delay: f.delay, own: snap !== f.d });
        total += f.delay; progress(Math.min(0.4, total / 12000 * 0.4), `Frame ${f.index + 1}`);
        if (total >= 12000) break;
      }
    }
    const scale = safeScale(items[0].res, S.exportScale);
    let [W, H] = pictureSize(items[0].res.cols, items[0].res.rows, S, scale); W += W & 1; H += H & 1;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const g = out.getContext('2d', { willReadFrequently: fmt === 'gif' }), art = document.createElement('canvas'), orig = document.createElement('canvas'); orig.width = W; orig.height = H;
    const writer = await videoWriter(fmt, W, H, fps);
    const total = items.reduce((a, it) => a + it.delay, 0), hold = total * 0.15;
    let t = 0;
    for (let i = 0; i < items.length; i++) {
      if (App.cancel) throw cancelled();
      const it = items[i], p = smooth01((t - hold) / Math.max(1, total - 2 * hold));
      drawOriginalLike(orig.getContext('2d'), it.d, W, H, scale);
      renderResult(it.res, settingsAt(t / 1000), art, scale, { bgMode: S.bgMode === 'transparent' ? 'solid' : undefined });
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.drawImage(orig, 0, 0);
      if (style === 'fade') { g.globalAlpha = p; g.drawImage(art, 0, 0); g.globalAlpha = 1; }
      else {   // the art comes in from the left behind a bright line
        const x = Math.round(p * W);
        if (x > 0) { g.save(); g.beginPath(); g.rect(0, 0, x, H); g.clip(); g.drawImage(art, 0, 0); g.restore(); }
        if (p > 0 && p < 1) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - 2, 0, 5, H); g.fillStyle = '#fff'; g.fillRect(x - 1, 0, 3, H); }
      }
      await writer.add(out, it.delay); t += it.delay;
      if (i % 4 === 3) { progress(0.4 + 0.55 * (i + 1) / items.length, `Frame ${i + 1} / ${items.length}`); await nextTick(); }
    }
    for (const it of items) if (it.own) it.d[0].close();
    const blob = await writer.finish();
    download(blob, baseName() + '_before-after.' + fmt);
    toast(`Before → after ${fmt.toUpperCase()} saved (${fmtBytes(blob.size)}, ${(total / 1000).toFixed(1)} s)`);
    return blob;
  });
}
function openRevealDialog() {
  if (!requireRes()) return;
  const d = $('#revealDialog'), moving = App.src.kind === 'anim' || App.src.kind === 'video';
  $$('#revealFmt option').forEach(o => { o.disabled = o.value !== 'gif' && !FAST_VIDEO_OK; });
  if ($('#revealFmt').selectedOptions[0].disabled) $('#revealFmt').value = 'gif';
  $('#revealSecsRow').hidden = moving;
  $('#revealNote').textContent = moving ? 'The animation plays while the wipe crosses it (up to 12 seconds, from the trim range).' : 'Starts with your picture, ends with the text art.';
  d.showModal();
}
function initReveal() {
  $('#revealSecs').addEventListener('input', e => { $('#revealSecsOut').textContent = e.target.value + ' s'; });
  $('#revealCancel').addEventListener('click', () => $('#revealDialog').close());
  $('#revealGo').addEventListener('click', () => { $('#revealDialog').close(); exportReveal($('#revealFmt').value, +$('#revealSecs').value, $('#revealStyle').value); });
}
