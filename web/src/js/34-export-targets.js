/* =====================================================================
   More ways out: stickers & emoji in each platform's size and file limit, terminal scripts that play the
   art, and copying the text as a string in program code
   ===================================================================== */
const STICKERS = {
  discordEmoji: { name: 'Discord emoji', size: 128, max: 256 * 1024, still: 'png', anim: 'gif', note: '128 × 128 · PNG or GIF · up to 256 KB' },
  discordSticker: { name: 'Discord sticker', size: 320, max: 512 * 1024, still: 'png', anim: 'apng', note: '320 × 320 · PNG or APNG · up to 512 KB' },
  slackEmoji: { name: 'Slack emoji', size: 128, max: 128 * 1024, still: 'png', anim: 'gif', note: '128 × 128 · PNG or GIF · up to 128 KB' },
  telegram: { name: 'Telegram sticker', size: 512, max: 512 * 1024, still: 'webp', anim: 'webm', animMax: 256 * 1024, maxSecs: 3, note: '512 × 512 · WEBP, or WEBM video up to 3 s and 256 KB' },
};
/* the export frames, each drawn and fitted into a size × size square (transparent around it) */
async function stickerFrames(size, maxSecs, progress) {
  const all = await collectResults(p => progress(p * 0.6, 'Converting…'));
  const c = document.createElement('canvas'), t = document.createElement('canvas'); t.width = t.height = size;
  const g = t.getContext('2d', { willReadFrequently: true }), out = [];
  let total = 0;
  for (const { res, d } of all) {
    if (maxSecs && total >= maxSecs * 1000) break;
    renderResult(res, S, c, 1);
    const k = Math.min(size / c.width, size / c.height), w = Math.round(c.width * k), h = Math.round(c.height * k);
    g.clearRect(0, 0, size, size); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(c, (size - w) >> 1, (size - h) >> 1, w, h);
    out.push({ rgba: g.getImageData(0, 0, size, size).data, delay: Math.max(20, d) }); total += d;
  }
  return out;
}
/* every second frame (their delays added), for files that are too big */
const halveFrames = fr => { const o = []; for (let i = 0; i < fr.length; i += 2) o.push({ rgba: fr[i].rgba, delay: fr[i].delay + (fr[i + 1] ? fr[i + 1].delay : 0) }); return o; };
function stickerGif(frames, size, colors) {
  const e = new GifEncoder(size, size, 0);
  for (const f of frames) e.addFrameBytes(gifFrameBytes(f.rgba, colors, true, Math.max(2, Math.round(f.delay / 10)), 2, size, size));
  return new Blob([e.finish()], { type: 'image/gif' });
}
async function stickerApng(frames, size) {
  const enc = [];
  for (const f of frames) { const j = await apngJobBytes({ rgba: f.rgba, w: size, h: size }); enc.push({ w: size, h: size, x: 0, y: 0, delay: f.delay, blend: 0, data: j.data }); }
  return apngFile(size, size, enc);
}
async function stickerWebm(frames, size, bitrate) {
  if (typeof VideoEncoder === 'undefined') throw new Error('this browser cannot make videos');
  const fps = 30, cfg = await pickVideoCodec('webm', size, size, bitrate, fps); if (!cfg) throw new Error('this browser cannot make WEBM videos');
  const chunks = []; let err = null, t = 0;
  const enc = new VideoEncoder({ output: ch => { const data = new Uint8Array(ch.byteLength); ch.copyTo(data); chunks.push({ data, t: ch.timestamp / 1000, key: ch.type === 'key' }); }, error: e => { err = e; } });
  enc.configure(cfg);
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  for (const f of frames) {   // video has no transparency: the background colour behind
    g.fillStyle = S.bgMode === 'transparent' ? '#000' : S.bg; g.fillRect(0, 0, size, size);
    g.putImageData(new ImageData(new Uint8ClampedArray(f.rgba), size, size), 0, 0);
    const vf = new VideoFrame(c, { timestamp: Math.round(t * 1000), duration: Math.round(f.delay * 1000) }); enc.encode(vf, { keyFrame: t === 0 }); vf.close();
    t += f.delay;
  }
  await enc.flush(); enc.close(); if (err) throw err;
  chunks.sort((a, b) => a.t - b.t);
  return webmFile(size, size, cfg.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', chunks, t);
}
async function exportSticker(id) {
  const P = STICKERS[id], s = App.src; if (!requireRes()) return;
  const moving = s.kind === 'anim' || s.kind === 'video', fmt = moving ? P.anim : P.still, max = moving && P.animMax || P.max;
  await runExport('Making a ' + P.name, async progress => {
    let frames = await stickerFrames(P.size, moving ? P.maxSecs || 0 : 0, progress), blob = null, tries = 0;
    if (!moving) frames = frames.slice(0, 1);
    for (;;) {   // smaller until it fits: fewer colours, then fewer frames
      tries++;
      progress(0.6 + 0.35 * Math.min(1, tries / 6), 'Fitting the size limit…');
      if (fmt === 'png' || fmt === 'webp') {
        const c = document.createElement('canvas'); c.width = c.height = P.size; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(frames[0].rgba), P.size, P.size), 0, 0);
        blob = await canvasToBlob(c, 'image/' + fmt, fmt === 'webp' ? Math.max(0.3, 0.92 - tries * 0.12) : undefined);
        if (blob.size <= max || fmt === 'png' || tries > 6) break;
      } else if (fmt === 'gif') {
        const colors = [256, 128, 64, 32, 16][Math.min(4, tries - 1)];
        blob = stickerGif(frames, P.size, colors);
        if (blob.size <= max || tries > 8) break;
        if (tries >= 5 && frames.length > 2) frames = halveFrames(frames);
      } else if (fmt === 'apng') {
        blob = await stickerApng(frames, P.size);
        if (blob.size <= max || frames.length <= 2 || tries > 5) break;
        frames = halveFrames(frames);
      } else {
        blob = await stickerWebm(frames, P.size, Math.round(600000 / tries));
        if (blob.size <= max || tries > 5) break;
      }
    }
    const ext = fmt === 'apng' ? 'png' : fmt;
    download(blob, `${baseName()}_${id}.${ext}`);
    toast(blob.size <= max ? `${P.name} saved (${fmtBytes(blob.size)}, fits the ${fmtBytes(max)} limit)` : `${P.name} saved, but it is ${fmtBytes(blob.size)} (limit ${fmtBytes(max)}). Try fewer characters or a shorter trim`, blob.size <= max ? undefined : 'error');
  });
}
/* ---- terminal scripts that print (and loop) the art with its colours ---- */
async function exportTerminalScript(kind) {
  if (!requireRes()) return;
  await runExport('Making the script', async progress => {
    const all = await collectResults(progress), frames = all.map(f => resultANSI(f.res)), delays = all.map(f => Math.max(20, Math.round(f.d))), name = baseName();
    const anim = frames.length > 1, enc = new TextEncoder();
    let text, type = 'text/plain;charset=utf-8';
    if (kind === 'sh') {
      text = `#!/bin/sh\n# ${name}: text art made with Image to Text Converter.\n# Run it in a terminal:  sh ${name}.sh${anim ? '   (Ctrl+C stops)' : ''}\nprintf '\\033[2J\\033[?25l'\ntrap 'printf "\\033[0m\\033[?25h\\n"; exit 0' INT TERM\n` +
        (anim ? 'while :; do\n' : '') +
        frames.map((f, i) => `printf '\\033[H'\ncat <<'TAS_FRAME'\n${f.replace(/\n$/, '')}\nTAS_FRAME\n${anim ? `sleep ${(delays[i] / 1000).toFixed(3)}\n` : ''}`).join('') +
        (anim ? 'done\n' : 'printf "\\033[0m\\033[?25h"\n');
    } else if (kind === 'ps1') {
      text = '\ufeff' + [`# ${name}: text art made with Image to Text Converter.`, `# Run it:  powershell -ExecutionPolicy Bypass -File ${name}.ps1${anim ? '   (Ctrl+C stops)' : ''}`,
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8', '$E = [char]27', '$frames = @(',
        frames.map(f => "@'\n" + f.replace(/\n$/, '') + "\n'@").join(',\n'), ')', `$delays = @(${delays.join(', ')})`,
        '[Console]::Write("$E[2J$E[?25l")',
        'try {', '  do {', '    for ($i = 0; $i -lt $frames.Count; $i++) { [Console]::Write("$E[H" + $frames[$i]); if ($frames.Count -gt 1) { Start-Sleep -Milliseconds $delays[$i] } }', '  } while ($frames.Count -gt 1)',
        '} finally { [Console]::Write("$E[0m$E[?25h`n") }', ''].join('\r\n');
    } else {
      text = `#!/usr/bin/env python3\n# ${name}: text art made with Image to Text Converter.\n# Run it:  python ${name}.py${anim ? '   (Ctrl+C stops)' : ''}\nimport os, sys, time\n` +
        `FRAMES = [\n${frames.map(f => '    ' + JSON.stringify(f)).join(',\n')},\n]\nDELAYS = [${delays.join(', ')}]\n` +
        `if os.name == 'nt':\n    os.system('')  # lets Windows consoles show colours\ntry:\n    sys.stdout.reconfigure(encoding='utf-8')\nexcept Exception:\n    pass\nw = sys.stdout.write\nw('\\x1b[2J\\x1b[?25l')\n` +
        `try:\n    while True:\n        for f, d in zip(FRAMES, DELAYS):\n            w('\\x1b[H' + f)\n            sys.stdout.flush()\n            if len(FRAMES) > 1:\n                time.sleep(d / 1000)\n        if len(FRAMES) == 1:\n            break\nexcept KeyboardInterrupt:\n    pass\nfinally:\n    w('\\x1b[0m\\x1b[?25h\\n')\n`;
    }
    download(new Blob([enc.encode(text)], { type }), `${name}.${kind}`);
    toast(`${kind === 'sh' ? 'Shell' : kind === 'ps1' ? 'PowerShell' : 'Python'} script saved (${frames.length} frame${frames.length > 1 ? 's' : ''}). Run it in a terminal`);
  });
}
/* ---- the text as a string literal for program code ---- */
function codeLiteral(text, lang) {
  if (lang === 'js') return 'const art = `' + text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`;\n';
  if (lang === 'py') return 'art = (\n' + text.split('\n').map((l, i, a) => '    ' + JSON.stringify(l + (i < a.length - 1 ? '\n' : ''))).join('\n') + '\n)\n';
  if (lang === 'cs') return 'var art = @"' + text.replace(/"/g, '""') + '";\n';
  return JSON.stringify(text) + '\n';
}
function actCopyCode() {
  if (!requireRes()) return;
  const lang = $('#codeLang').value;
  copyOrShow(codeLiteral(resultText(App.res), lang), `Copied as ${({ js: 'JavaScript', py: 'Python', cs: 'C#', json: 'JSON' })[lang]} code`);
}
