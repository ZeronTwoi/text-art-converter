/* =====================================================================
   Look pictures that play along: while a GIF or video plays, the look cards show the current frame (a few times a
   second, only while they are on screen). If that is too slow on this computer it turns itself off; the "Play along"
   switch above the looks turns it on or off for good.
   ===================================================================== */
const LiveLooks = { on: true, busy: false, last: 0, slow: 0, maxMs: 250, every: 300 };
const LIVE_LOOKS_KEY = 'textArtStudio.liveLooks';
function setLiveLooks(on, auto) {
  LiveLooks.on = on; LiveLooks.slow = 0;
  try { localStorage.setItem(LIVE_LOOKS_KEY, on ? '1' : '0'); } catch (e) {}
  const b = $('#liveLooks'); b.setAttribute('aria-pressed', on); b.textContent = on ? '▶ Play along: on' : '▶ Play along: off';
  if (auto) toast('The look pictures stopped playing along: too slow on this computer (turn it on again above the looks)');
}
function liveLooksTick(now) {
  const s = App.src;
  if (!LiveLooks.on || LiveLooks.busy || !App.playing || !s || !(s.kind === 'anim' || s.kind === 'video') || now - LiveLooks.last < LiveLooks.every) return;
  if (App.exporting || App.peek || document.hidden || !$('#looks').offsetParent) return;
  LiveLooks.busy = true; LiveLooks.last = now;
  const t0 = performance.now();
  renderLooks().finally(() => {
    LiveLooks.busy = false;
    LiveLooks.slow = performance.now() - t0 > LiveLooks.maxMs ? LiveLooks.slow + 1 : 0;
    if (LiveLooks.slow >= 3 && LiveLooks.on) setLiveLooks(false, true);
  });
}
function initLiveLooks() {
  let on = true; try { on = localStorage.getItem(LIVE_LOOKS_KEY) !== '0'; } catch (e) {}
  $('#liveLooks').addEventListener('click', () => { setLiveLooks(!LiveLooks.on); if (!LiveLooks.on) scheduleLooks(); });
  setLiveLooks(on);
}
