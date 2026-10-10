/* =====================================================================
   Start: build the UI, then open a demo when the address asks for one (#demo, #demoanim, #demo=<look>…)
   ===================================================================== */
initUI();
if (location.hash.startsWith('#demo=')) {   // e.g. #demo=ASCII%3A%20colour;platform=instagram;view=platform
  const [preset, ...kv] = decodeURIComponent(location.hash.slice(6)).split(';');
  if (PRESETS[preset]) Object.assign(S, PRESETS[preset]);
  const o = Object.fromEntries(kv.map(x => x.split('=')));
  if (o.platform && PLATFORMS[o.platform]) S.platform = o.platform;
  if (o.cols) S.cols = +o.cols;
  if (o.outline) S.outline = +o.outline;
  S.shareOptimize = o.fix === '1'; S.shareSplit = o.split === '1'; S.shareColor = o.colour === '1'; S.shareTarget = o.target || 'phone';
  demoImage().then(() => { syncControls(); if (o.view) setView(o.view); if (o.cal === '1') setTimeout(openCalibration, 300); });
}
else if (location.hash === '#demo') demoImage();
else if (location.hash.startsWith('#demoanim')) { const gm = /goal=(\w+)/.exec(location.hash); if (gm) S.exportGoal = gm[1]; demoAnim(); }
