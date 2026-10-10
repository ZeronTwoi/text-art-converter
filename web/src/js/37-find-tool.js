/* =====================================================================
   Find a tool (Ctrl+K or 🔍): every feature by name, with where it lives; Enter opens or runs it.
   What's new: shown once to people who used an earlier version, each item with "Show me".
   ===================================================================== */
/* bring a control into view: the right tab / panel, scrolled to and briefly highlighted */
function showControl(el, tab) {
  if (!el) return;
  if (tab) { setTab(tab); if (isNarrow()) setSheet('settings'); }
  for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;   // open the folds it is in
  if (el.matches && el.matches('.look.extra')) setAllLooks(true);
  else if (el.closest('#exportPanel') && isNarrow()) setSheet('export');
  if (!el.offsetParent) { const g = el.closest('[data-when]'); if (g && g.hidden) toast('That option appears when it applies (e.g. for this style or colour choice)'); }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const box = el.closest('.row, .group, .xsec, button') || el;
  box.classList.remove('flashfocus'); void box.offsetWidth; box.classList.add('flashfocus');
  setTimeout(() => box.classList.remove('flashfocus'), 1800);
  if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) setTimeout(() => el.focus({ preventScroll: true }), 350);
}
const key = k => $(`[data-key="${k}"]`);
function showExport(goal, label) {
  S.exportGoal = goal; saveSettings(); applyGoal();
  const b = label && $$('#exportBody button, #exportBody label, #exportBody select').find(x => x.textContent.trim().startsWith(label) || x.id === label);
  showControl(b || $(`#goalSeg [data-goal="${goal}"]`));
}
const needSrc = fn => () => { if (!App.src) { toast('Open a picture first'); gotoStep(1); return; } fn(); };
const MODE_WORDS = { braille: 'dots', ascii: 'letters characters', glyph: 'shape match', edge: 'lines sketch', half: 'pixel blocks', quad: 'mosaic blocks', halftone: 'print dots', word: 'lyrics words', emoji: 'emoji mosaic' };
function toolList() {
  const T = [];
  const add = (name, where, keys, run) => T.push({ name, where, keys, run });
  add('Open a picture, GIF or video', 'Start', 'file load import upload', () => $('#fileInput').click());
  add('Use the webcam', 'Start', 'camera live', startWebcam);
  add('Text → picture (paste text art)', 'Start', 'ascii ansi paste type', () => openTextDialog(''));
  add('Try the demo picture', 'Start', 'example sample', demoImage);
  add('Try the demo animation', 'Start', 'example sample gif', demoAnim);
  add('Batch convert many files (one ZIP)', 'Start', 'many folder zip bulk', openBatchDialog);
  add('Save project (.textart)', 'Projects', 'save keep later file ctrl+s', saveProject);
  add('Open a project', 'Projects', 'load textart', () => $('#fileInput').click());
  add('Forget my last picture', 'This browser', 'privacy delete session', () => sessionForget(false));
  add('Pick a look (styles gallery)', 'Look tab', 'preset theme quick', () => showControl($('#looks'), 'look'));
  add('Bigger previews of every look', 'Look tab', 'gallery preview', openGallery);
  for (const [k, m] of Object.entries(MODES)) if (k !== 'text') add(`Style: ${m.name}`, 'Look tab', 'mode drawn with ' + (MODE_WORDS[k] || ''), () => { applySettings({ mode: k }); showControl($(`.mode[data-mode="${k}"]`), 'look'); });
  add('Design your own characters', 'Look tab', 'character set charset designer letters ramp custom', openDesigner);
  add('Characters used (character set)', 'Look tab', 'charset ramp letters', () => showControl($('#charsetSel'), 'look'));
  add('Caption: words on the picture', 'Look tab', 'title subtitle text write', () => showControl($('#capTop'), 'look'));
  add('Animate a still picture (typewriter, Matrix rain, glitch…)', 'Look tab', 'effect motion gif typewriter rain glitch zoom scanlines', needSrc(() => showControl($('#fxKind'), 'look')));
  add('Width in characters (size)', 'Adjust tab', 'columns resolution detail size', () => showControl(key('cols'), 'adjust'));
  for (const [k, n] of [['brightness', 'Brightness'], ['contrast', 'Contrast'], ['gamma', 'Gamma'], ['saturation', 'Saturation'], ['outline', 'Outlines'], ['fill', 'Shading'], ['bgFade', 'Hide plain background']])
    add(n, 'Adjust tab', 'light tone ' + k, () => { if (['gamma', 'saturation'].includes(k)) setAdvanced(true); showControl(key(k), 'adjust'); });
  add('Brightness histogram', 'Adjust tab', 'levels clipping graph', () => showControl($('#toneHist'), 'adjust'));
  add('Change over time (fade in, ramps)', 'Adjust tab', 'animation video keyframe ramp fade', () => showControl($('#rampAdd'), 'adjust'));
  for (const [v, n] of [['color', 'Original colours'], ['mono', 'Single colour'], ['app', 'App & retro colours (Discord, Game Boy, C64…)'], ['gray', 'Greyscale'], ['gradient', 'Gradient colours']])
    add(n, 'Colour tab', 'colour color palette ' + v, () => { applySettings({ colorMode: v }); showControl($(`.choices[data-choice="colorMode"] [data-val="${v}"]`), 'colour'); });
  add('Your own palette (from the picture, paste, lospec)', 'Colour tab', 'palette colors hex gpl lospec custom', () => { applySettings({ colorMode: 'app', appPalette: 'custom' }); showControl($('#palSwatches'), 'colour'); });
  add('Background: solid, transparent or tinted', 'Colour tab', 'transparent png alpha', () => showControl($('.choices[data-choice="bgMode"]'), 'colour'));
  add('Font (incl. the built-in pixel font)', 'Colour tab', 'typeface pixel font consolas', () => showControl(key('fontFamily'), 'colour'));
  add('Draw the crop on the picture', 'Crop tab', 'cut frame trim', needSrc(() => { setTab('crop'); setCropMode(true); }));
  add('Auto-trim empty borders', 'Crop tab', 'crop border', needSrc(actAutoTrim));
  add('Turn or mirror the picture', 'Crop tab', 'rotate flip mirror', () => showControl(key('rotate'), 'crop'));
  add('Paint a mask (hide or keep areas)', 'Crop tab', 'brush erase hide keep', needSrc(() => { setTab('crop'); setMaskMode(true); }));
  add('Edit single characters (brush)', 'Above the picture', 'draw paint character edit', needSrc(() => setEditMode(true)));
  add('Type text onto the art', 'Edit', 'write cursor keyboard', needSrc(() => { setEditMode(true); Edit.tool = 'type'; updateEditUI(); }));
  add('Select, copy, move or fill a box of characters', 'Edit', 'selection clipboard cut paste', needSrc(() => { setEditMode(true); Edit.tool = 'select'; updateEditUI(); }));
  add('Flood fill an area', 'Edit', 'bucket fill', needSrc(() => { setEditMode(true); Edit.tool = 'fill'; updateEditUI(); }));
  for (const [v, n, k2] of [['split', 'Compare side by side', 'before after original'], ['wipe', 'Wipe: drag between original and result', 'before after slider'], ['src', 'Show the original', 'source'], ['text', 'Show the raw text', 'select copy'], ['platform', 'Preview in a chat app', 'discord phone']])
    add(n, 'View', k2, needSrc(() => setView(v)));
  add('Full screen / OBS view', 'View', 'present fullscreen stream obs browser source', needSrc(() => setPresent(true)));
  add('Customize the screen (hide parts)', 'More', 'hide simplify declutter steps status', openCustomize);
  add('Keep these settings as a version (A–D)', 'Above the picture', 'snapshot compare ab a/b', needSrc(keepVersion));
  add('Fit the picture / zoom', 'View', 'zoom 100 fit', () => { App.zoom = App.zoom ? 0 : 1; applyZoom(); });
  add('Send in a chat app (Discord, WhatsApp…)', 'Share panel', 'copy paste message', () => showExport('chat'));
  add('Fix all for the chat app', 'Share panel', 'fit limit width phone', () => showExport('chat', 'fixAllBtn'));
  add('Calibrate for my phone', 'Share panel', 'phone width ring', openCalibration);
  for (const [lab, k2] of [['PNG', 'picture image save'], ['JPG', 'jpeg'], ['GIF', 'animation'], ['MP4', 'video'], ['WEBM', 'video'], ['APNG', 'animated png'], ['WEBP anim', 'animated webp']])
    add('Save ' + lab, 'Share panel', k2 + ' download export', needSrc(() => showExport('save', lab)));
  add('Before → after video (picture turns into the art)', 'Share panel', 'reveal transformation wipe fade video gif mp4 tiktok reel', needSrc(openRevealDialog));
  add('Print or poster (A4, A3, PDF)', 'Share panel', 'print paper pdf poster a4 a3 letter', needSrc(openPoster));
  add('Plotter / laser SVG (lines only)', 'Share panel', 'plotter laser cutter pen cnc svg lines hatching', needSrc(openPlotter));
  add('Stickers & emoji (Discord, Slack, Telegram)', 'Share panel', 'sticker emoji discord slack telegram', needSrc(() => showExport('save', 'Discord emoji')));
  add('Copy as text', 'Share panel', 'clipboard plain', needSrc(actCopyText));
  add('Copy with colours (Word, email)', 'Share panel', 'rich html clipboard', needSrc(actCopyHTML));
  add('Copy ANSI (terminal colours)', 'Share panel', 'terminal escape', needSrc(actCopyANSI));
  add('Save .txt / .html / .ans / .svg', 'Share panel', 'text file svg html', needSrc(() => showExport('text', '.txt')));
  add('Copy as code (JavaScript, Python, C#)', 'Share panel', 'string program developer json', needSrc(() => showExport('text', 'codeLang')));
  add('Copy a link to this art', 'Share panel', 'url link share', needSrc(actCopyLink));
  add('Terminal script that plays it (.sh, .ps1, .py)', 'Share panel', 'powershell bash python console', needSrc(() => showExport(App.src.kind === 'anim' || App.src.kind === 'video' ? 'save' : 'text', App.src.kind === 'anim' || App.src.kind === 'video' ? 'Terminal .sh' : '.sh')));
  if (canShareText()) add('Share to another app', 'Share panel', 'share sheet send', needSrc(() => showExport('save', 'Share…')));
  add('Undo', 'Top bar', 'back ctrl+z', () => UndoHistory.step(true));
  add('Redo', 'Top bar', 'forward ctrl+y', () => UndoHistory.step(false));
  add('Light or dark theme', 'Top bar', 'dark mode light colours', () => $('#btnTheme').click());
  add('Show every expert setting (Advanced)', 'Top bar', 'expert more options', () => setAdvanced(true));
  add('Take the tour again', 'Help', 'tour guide intro first steps', startTour);
  add('How it works (help)', 'Top bar', 'guide manual keyboard shortcuts', () => $('#helpDialog').showModal());
  add("What's new", 'Top bar', 'news changes features', openWhatsNew);
  if (App.installPrompt) add('Install as an app', 'More', 'offline pwa desktop', () => $('#btnInstall').click());
  return T;
}
const findState = { list: [], sel: 0 };
function findFilter(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean), all = toolList();
  if (!words.length) return all;
  return all.map(t => { const hay = (t.name + ' ' + t.keys + ' ' + t.where).toLowerCase(), name = t.name.toLowerCase(); if (!words.every(w => hay.includes(w))) return null;
    return { t, score: (name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2) }; }).filter(Boolean).sort((a, b) => a.score - b.score).map(x => x.t);
}
function renderFind() {
  const ul = $('#findList'); ul.textContent = '';
  findState.list.slice(0, 60).forEach((t, i) => {
    const li = document.createElement('li'); li.setAttribute('role', 'option'); li.id = 'find-' + i; li.className = i === findState.sel ? 'on' : '';
    li.setAttribute('aria-selected', String(i === findState.sel));
    li.innerHTML = '<span></span><small></small>'; li.firstChild.textContent = t.name; li.lastChild.textContent = t.where;
    li.addEventListener('pointerdown', e => { e.preventDefault(); runFind(i); });
    ul.appendChild(li);
  });
  $('#findInput').setAttribute('aria-activedescendant', findState.list.length ? 'find-' + findState.sel : '');
  $('#findEmpty').hidden = findState.list.length > 0;
  const on = ul.children[findState.sel]; if (on) on.scrollIntoView({ block: 'nearest' });
}
function openFind() {
  const d = $('#findDialog'), inp = $('#findInput');
  inp.value = ''; findState.list = findFilter(''); findState.sel = 0; renderFind();
  if (!d.open) d.showModal(); inp.focus();
}
function runFind(i) {
  const t = findState.list[i]; if (!t) return;
  $('#findDialog').close();
  setTimeout(() => { try { t.run(); } catch (e) { console.error(e); } }, 30);
}
/* ---- what's new: once for people who used an earlier version ---- */
const WHATS_NEW_ID = '2026-10';
const WAS_HERE_BEFORE = (() => { try { return !!localStorage.getItem('textArtStudio.seenHelp'); } catch (e) { return false; } })();   // read before start-up marks it
const WHATS_NEW = [
  ['Point at a look to preview it', 'Pick a look (styles gallery)'], ['Wipe between original and result', 'Wipe: drag between original and result'],
  ['Draw the crop on the picture', 'Draw the crop on the picture'], ['Edit characters: brush, type, select, fill', 'Edit single characters (brush)'],
  ['Captions and big letters', 'Caption: words on the picture'], ['Animate a still picture', 'Animate a still picture (typewriter, Matrix rain, glitch…)'],
  ['Emoji mosaic, retro palettes and your own palette', 'Your own palette (from the picture, paste, lospec)'], ['Built-in pixel font', 'Font (incl. the built-in pixel font)'],
  ['Versions A–D to compare settings', 'Keep these settings as a version (A–D)'], ['Settings that change over time', 'Change over time (fade in, ramps)'],
  ['Projects and "continue where you left off"', 'Save project (.textart)'], ['Stickers, terminal scripts, code and links', 'Stickers & emoji (Discord, Slack, Telegram)'],
];
function openWhatsNew() {
  const box = $('#newsList'); box.textContent = '';
  for (const [title, tool] of WHATS_NEW) {
    const li = document.createElement('li'); li.innerHTML = '<span></span><button class="btn">Show me</button>'; li.firstChild.textContent = title;
    li.lastChild.addEventListener('click', () => { $('#newsDialog').close(); const t = toolList().find(x => x.name === tool); if (t) setTimeout(() => t.run(), 30); });
    box.appendChild(li);
  }
  $('#newsDialog').showModal();
  try { localStorage.setItem('textArtStudio.seenNews', WHATS_NEW_ID); } catch (e) {}
}
function initFindTool() {
  $('#btnFind').addEventListener('click', openFind);
  $('#findClose').addEventListener('click', () => $('#findDialog').close());
  $('#newsClose').addEventListener('click', () => $('#newsDialog').close());
  $('#btnNews').addEventListener('click', openWhatsNew);
  $('#helpNews').addEventListener('click', () => { $('#helpDialog').close(); openWhatsNew(); });
  $('#newsFind').addEventListener('click', () => { $('#newsDialog').close(); openFind(); });
  const inp = $('#findInput');
  inp.addEventListener('input', () => { findState.list = findFilter(inp.value); findState.sel = 0; renderFind(); });
  inp.addEventListener('keydown', e => {
    const n = Math.min(60, findState.list.length);
    if (e.key === 'ArrowDown') { e.preventDefault(); findState.sel = (findState.sel + 1) % Math.max(1, n); renderFind(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); findState.sel = (findState.sel - 1 + n) % Math.max(1, n); renderFind(); }
    else if (e.key === 'Enter') { e.preventDefault(); runFind(findState.sel); }
  });
  window.addEventListener('keydown', e => {
    const typing = e.target.closest && e.target.closest('input,textarea,select,[contenteditable]');
    if (((e.ctrlKey || e.metaKey) && !e.altKey && (e.key || '').toLowerCase() === 'k') || (e.key === '/' && !typing && !Edit.on)) {
      if (document.querySelector('dialog[open]:not(#findDialog)')) return;
      e.preventDefault(); openFind();
    }
  });
  // returning users see what's new once; new users get the "New here?" hint instead
  let seen = null, returning = false;
  try { seen = localStorage.getItem('textArtStudio.seenNews'); returning = WAS_HERE_BEFORE; } catch (e) {}
  if (!/^#./.test(location.hash) && seen !== WHATS_NEW_ID) {
    if (returning) setTimeout(openWhatsNew, 900);
    else try { localStorage.setItem('textArtStudio.seenNews', WHATS_NEW_ID); } catch (e) {}
  }
}
