/* =====================================================================
   Full screen / OBS view: only the art, on black. For streaming, an OBS "Browser source" can open
   index.html#present=webcam;s=<your look> (OBS has its own browser, so the look travels in the address).
   ===================================================================== */
const Present = { on: false, timer: 0 };
function setPresent(on, fullscreen = true) {
  Present.on = !!on && !!App.src;
  document.body.classList.toggle('present', Present.on);
  if (Present.on) {
    if (Edit.on) setEditMode(false); if (Crop.on) setCropMode(false); if (Mask.on) setMaskMode(false);
    Present.view = App.view; setView('out'); App.zoom = 0; applyZoom(); presentBar();
    if (fullscreen && document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  } else {
    if (Present.view) setView(Present.view);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  App.dirty = true;
}
/* the little bar shows on mouse movement and hides after 2.5 s */
function presentBar() { const b = $('#presentBar'); b.classList.add('show'); clearTimeout(Present.timer); Present.timer = setTimeout(() => b.classList.remove('show'), 2500); }
/* an address that opens the webcam (or the demo) full screen in your current look */
async function presentLink(what = 'webcam') {
  const s = {}; for (const k in DEFAULTS) if (!LOOK_SKIP.has(k) || k === 'cols') s[k] = S[k];
  const z = await deflateRaw(new TextEncoder().encode(JSON.stringify(s)));
  return location.href.replace(/#.*$/, '') + `#present=${what};s=${b64url(z)}`;
}
async function openPresentLink(hash) {
  const m = /^#present(?:=(\w+))?(?:;s=([A-Za-z0-9_-]+))?/.exec(hash); if (!m) return false;
  if (m[2]) try {
    const o = JSON.parse(new TextDecoder().decode(await inflateRaw(unb64url(m[2])))), st = {};
    for (const k in o) if (k in DEFAULTS && typeof o[k] === typeof DEFAULTS[k]) st[k] = o[k];
    applySettings(st);
  } catch (e) { console.warn('present settings', e); }
  if (m[1] === 'webcam') await startWebcam(); else await demoImage();
  setPresent(true, false);
  return true;
}
function initPresent() {
  $('#btnPresent').addEventListener('click', () => { if (!App.src) return toast('Open a picture first'); setPresent(!Present.on); });
  $('#presentExit').addEventListener('click', () => setPresent(false));
  $('#presentObs').addEventListener('click', async () => copyOrShow(await presentLink('webcam'), 'OBS link copied: in OBS add a "Browser" source, untick "Local file", paste it as the URL (it opens the webcam in this look)'));
  document.addEventListener('pointermove', () => { if (Present.on) presentBar(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && Present.on && !location.hash.startsWith('#present')) setPresent(false); });
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea,select') || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && Present.on) { e.preventDefault(); setPresent(false); }
    else if (e.key === 'F11' && App.src) { e.preventDefault(); setPresent(!Present.on); }
  });
  if (location.hash.startsWith('#present')) openPresentLink(location.hash);
}
