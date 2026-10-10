/* =====================================================================
   Video check (open test.html#videotest in your browser, press Start): makes a short test video here and
   checks playback, frame updates in every view, the look preview, looping, seeking and video export with
   real video decoding (automated headless browsers cannot show video frames reliably).
   ===================================================================== */
async function videoTest() {
  const out = $('#selftest'); out.hidden = false;
  const log = [], say = l => { log.push(l); out.textContent = log.join('\n'); };
  const ok = (name, c, d) => { say(`${c ? 'PASS' : 'FAIL'} ${name}${d ? ' (' + d + ')' : ''}`); return c; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const sig = c => { const t = document.createElement('canvas'); t.width = 48; t.height = 32; const g = t.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0, 48, 32); let h = 0; for (const v of g.getImageData(0, 0, 48, 32).data) h = (h * 31 + v) | 0; return h; };
  const changes = async (fn, ms = 1200) => { const seen = new Set(); const end = performance.now() + ms; while (performance.now() < end) { seen.add(fn()); await wait(120); } return seen.size; };
  say('Video check: press Start (a click lets the browser play video with sound settings as usual).');
  const go = document.createElement('button'); go.className = 'btn primary'; go.textContent = '▶ Start the video check'; go.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:90';
  document.body.appendChild(go);
  await new Promise(r => go.addEventListener('click', r, { once: true })); go.remove();
  try {
    say('Making a 3-second test video…');
    await demoAnim(); await wait(100);
    const files = [];
    for (const ext of ['webm', 'mp4']) {
      if (!FAST_VIDEO_OK) break;
      try { const got = await uiCaptureDownloads(() => exportVideoFast(ext)); if (got[0]) files.push(new File([got[0].blob], 'check.' + ext, { type: got[0].blob.type })); } catch (e) { say(`NOTE ${ext.toUpperCase()} could not be made here: ${e.message}`); }
    }
    ok('Test video made', files.length > 0, files.map(f => f.name + ' ' + fmtBytes(f.size)).join(', '));
    for (const file of files) {
      say(`\n— ${file.name} —`);
      await openFile(file); await wait(400);
      const s = App.src, v = s.video;
      ok('Opens as a video', s.kind === 'video' && v.duration > 2.5, s.kind + ' ' + (v.duration || 0).toFixed(2) + ' s');
      setView('split'); App.loop = true; setPlaying(true); await wait(500);
      const t0 = v.currentTime; await wait(700);
      ok('Plays', !v.paused && v.currentTime > t0 + 0.3, `${t0.toFixed(2)} → ${v.currentTime.toFixed(2)} s`);
      ok('Video frames change while playing', await changes(() => sig(v)) > 3);
      ok('Compare view: the original moves', await changes(() => sig($('#srcCanvas'))) > 3);
      ok('Compare view: the result moves', await changes(() => sig($('#outCanvas'))) > 3);
      setView('text'); await wait(200);
      ok('Text view moves', await changes(() => $('#rawText').textContent.length + ':' + $('#rawText').textContent.slice(200, 260)) > 2);
      setView('split'); startPeek('Matrix'); await wait(300);
      ok('Previewing a look: the original keeps moving', await changes(() => sig($('#srcCanvas'))) > 3);
      endPeek();
      const loops = v.currentTime; await wait((v.duration - v.currentTime) * 1000 + 1200);
      ok('Loops at the end and keeps playing', !v.paused && App.playing, `was ${loops.toFixed(2)} s, now ${v.currentTime.toFixed(2)} s, ${v.paused ? 'paused' : 'playing'}`);
      setPlaying(false); seekTo(1.0); await wait(500); renderNow();
      const a = sig($('#outCanvas')); seekTo(2.0); await wait(500); renderNow();
      ok('Seeking shows another frame', sig($('#outCanvas')) !== a);
      App.tin = 0.5; App.tout = 1.5; updateTrimBar();
      const ext = file.name.split('.').pop(), got = await uiCaptureDownloads(() => exportVideoFast(ext));
      let dur = 0;
      if (got[0]) { const t = document.createElement('video'); t.muted = true; t.src = URL.createObjectURL(got[0].blob); await new Promise(r => { t.onloadedmetadata = r; t.onerror = r; setTimeout(r, 4000); }); dur = t.duration; URL.revokeObjectURL(t.src); }
      ok('Exporting the trimmed part (1 s) as ' + ext.toUpperCase(), Math.abs(dur - 1) < 0.15, dur.toFixed(2) + ' s');
      // video tools on a real video: frames are taken by seeking, so order and speed follow the plan
      const texts = rs => rs.map(x => resultText(x.res));
      applySettings({ playOrder: 'forward', playSpeed: 2, loopFade: 0 }); const fwd = texts(await collectResults(() => {}));
      applySettings({ playOrder: 'reverse' }); const rev = texts(await collectResults(() => {}));
      ok('Video tools: 2× speed takes half the frames', fwd.length === Math.floor(S.gifFps / 2 + 1e-6), fwd.length + ' frames at ' + S.gifFps + ' fps');
      ok('Video tools: reversed is the same frames backwards', rev.length === fwd.length && rev.every((t, i) => t === fwd[fwd.length - 1 - i]));
      applySettings({ playOrder: 'forward', playSpeed: 1, loopFade: 0.25 }); const f0 = Pool.failures.length, fade = await collectResults(() => {});
      ok('Video tools: smooth loop fades the end into the start', fade.length < S.gifFps && fade.length > S.gifFps / 2 && Pool.failures.length === f0, fade.length + ' frames, ' + (Pool.failures.length - f0) + ' worker failures');
      applySettings({ playOrder: 'forward', playSpeed: 1, loopFade: 0 });
      clearTrim();
    }
  } catch (e) { console.error(e); say('FAIL the check stopped: ' + (e && e.message || e)); }
  const fails = log.filter(l => l.startsWith('FAIL')).length;
  say(`\n${fails ? 'FAIL' : 'PASS'} ${log.filter(l => l.startsWith('PASS')).length} passed, ${fails} failed`);
  document.title = fails ? 'VIDEOTEST FAIL' : 'VIDEOTEST PASS';
}
