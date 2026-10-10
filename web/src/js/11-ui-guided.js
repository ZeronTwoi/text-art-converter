/* =====================================================================
   UI 2: tabs, guided steps, goals, looks gallery, choices, filmstrip
   ===================================================================== */
const PRESET_BASE = { invert: false, edge: 0, sharpen: 0, outline: DEFAULTS.outline, outlineWidth: 1, fill: 1, localContrast: 0, bgFade: 0, bgMode: 'solid', sortRamp: false, saturation: 1, threshold: 0.5, brightness: 0, contrast: 0, gamma: 1 };
/* Your own looks: everything except settings that belong to one picture (width, crop, turn) or to sharing/exporting. */
const LOOK_STORE = 'textArtStudio.looks.v1';
const LOOK_SKIP = new Set(['captionTop', 'captionBottom', 'captionStyle', 'captionBox', 'captionColor', 'cols', 'cropL', 'cropR', 'cropT', 'cropB', 'rotate', 'flipH', 'flipV', 'platform', 'shareOptimize', 'shareTarget', 'shareSplit', 'shareColor', 'shareTheme', 'calib', 'exportGoal', 'exportScale', 'quality', 'gifFps', 'frameStep', 'gifColors', 'gifDiff', 'gifDither', 'gifPalette', 'videoFps', 'videoBitrate', 'includeAudio', 'animRepeat', 'fontSize']);
let userLooks = [];
function loadUserLooks() {
  try {
    const list = JSON.parse(localStorage.getItem(LOOK_STORE) || '[]');
    userLooks = (Array.isArray(list) ? list : []).filter(l => l && typeof l.name === 'string' && l.settings && typeof l.settings === 'object').map(l => {
      const settings = {};
      for (const k in l.settings) if (k in DEFAULTS && !LOOK_SKIP.has(k) && typeof l.settings[k] === typeof DEFAULTS[k]) settings[k] = l.settings[k];
      return { name: l.name.slice(0, 40), settings };
    });
  } catch (e) { userLooks = []; }
}
function storeUserLooks() { try { localStorage.setItem(LOOK_STORE, JSON.stringify(userLooks)); } catch (e) { toast('Could not save: browser storage is unavailable', 'error'); } }
const USER_PREFIX = 'user:';
/* settings of a look card: a built-in preset (on top of the neutral base) or one of yours */
function lookSettings(id) {
  if (id.startsWith(USER_PREFIX)) { const u = userLooks.find(l => USER_PREFIX + l.name === id); return u ? u.settings : null; }
  return PRESETS[id] ? Object.assign({}, PRESET_BASE, PRESETS[id]) : null;
}
function applyPreset(id) {
  const st = lookSettings(id); if (!st) return;
  endPeek(true);
  UndoHistory.commit(); applySettings(Object.assign({}, st)); UndoHistory.commit();   // one undo step per look
  App.look = id; markLooks(); toast('Look: ' + id.replace(USER_PREFIX, ''));
}
/* Preview a look on the big picture while the pointer rests on its card (or the card has keyboard focus).
   Nothing changes until the card is clicked: exports and sharing keep using your settings. */
let peekTimer = 0;
function startPeek(id) { const st = lookSettings(id); if (st) startPeekWith(Object.assign({}, S, st), id.replace(USER_PREFIX, '')); }
/* preview any settings on the big picture (looks, versions) */
function startPeekWith(settings, label) {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (!App.src || App.exporting) return;
    App.peek = settings; App.dirty = true;
    const b = $('#peekBadge'); b.textContent = 'Preview: ' + label + ' (click to use it)'; b.hidden = false;
  }, 140);
}
function endPeek(quiet) {
  clearTimeout(peekTimer);
  if (!App.peek) return;
  App.peek = null; App.peekId = null; $('#peekBadge').hidden = true;
  if (!quiet) App.dirty = true;
}
function saveUserLook(name) {
  name = String(name || '').trim().slice(0, 40); if (!name) return false;
  const settings = {}; for (const k in DEFAULTS) if (!LOOK_SKIP.has(k)) settings[k] = S[k];
  const i = userLooks.findIndex(l => l.name === name);
  if (i >= 0) userLooks[i] = { name, settings }; else userLooks.push({ name, settings });
  storeUserLooks(); buildLooks(); App.look = USER_PREFIX + name; markLooks(); scheduleLooks();
  return true;
}
function deleteUserLook(name) {
  userLooks = userLooks.filter(l => l.name !== name); storeUserLooks();
  if (App.look === USER_PREFIX + name) App.look = null;
  buildLooks(); markLooks(); scheduleLooks();
}
function openLookDialog() {
  const d = $('#lookDialog'), inp = $('#lookName');
  let n = 1; while (userLooks.some(l => l.name === 'My look ' + n)) n++;
  inp.value = 'My look ' + n; d.showModal(); inp.focus(); inp.select();
}
/* the looks shown first; the others behind "Show all looks" (the active one is always shown) */
const FEATURED_LOOKS = ['Braille: colour', 'Braille: classic', 'ASCII: colour', 'Pixel art (half blocks)', 'Comic (outlines + shading)', 'Matrix', 'Emoji mosaic', 'Game Boy'];
function markLooks() { $$('.look').forEach(c => { c.classList.toggle('on', c.dataset.look === App.look); c.classList.toggle('shown', c.dataset.look === App.look); }); }
function setAllLooks(on) {
  $('#looks').classList.toggle('all', on); const b = $('#moreLooks');
  b.textContent = on ? 'Show fewer looks ▴' : `Show all ${Object.keys(PRESETS).length} looks ▾`; b.setAttribute('aria-expanded', on);
  try { localStorage.setItem('textArtStudio.allLooks', on ? '1' : ''); } catch (e) {}
  if (on) scheduleLooks();
}
function buildLooks() {
  const el = $('#looks'); el.innerHTML = '';
  const card = (id, label, user) => {
    const b = document.createElement('button'); b.className = 'look'; b.dataset.look = id; b.title = 'Apply the "' + label + '" look';
    b.innerHTML = '<canvas></canvas><span></span>'; b.querySelector('span').textContent = label;
    b.addEventListener('click', () => applyPreset(id));
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') startPeek(id); });
    b.addEventListener('pointerleave', () => endPeek());
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) startPeek(id); });
    b.addEventListener('blur', () => endPeek());
    if (user) {
      const x = document.createElement('i'); x.className = 'del'; x.textContent = '✕'; x.title = 'Delete this look'; x.setAttribute('role', 'button');
      x.addEventListener('click', e => { e.stopPropagation(); if (confirm(`Delete your look "${label}"?`)) deleteUserLook(label); });
      b.appendChild(x);
    }
    el.appendChild(b);
  };
  for (const name of Object.keys(PRESETS)) { card(name, name, false); if (!FEATURED_LOOKS.includes(name)) el.lastChild.classList.add('extra'); }
  for (const l of userLooks) card(USER_PREFIX + l.name, l.name, true);
  const add = document.createElement('button'); add.className = 'look add'; add.title = 'Save the current settings as your own look';
  add.innerHTML = '<b>+</b><span>Save current look</span>'; add.addEventListener('click', openLookDialog);
  el.appendChild(add);
}
let looksTimer = 0, looksSig = '';
function scheduleLooks() { clearTimeout(looksTimer); looksTimer = setTimeout(() => { renderLooks(); renderVersionThumbs(); if ($('#galleryDialog').open) renderGallery(); }, 200); }
const renderLooks = () => renderLookCards($$('#looks .look[data-look]').filter(c => c.offsetParent), { cols: 56, fontSize: 4 }, renderLooks);
/* draws each look card's picture: the current picture (or the demo) in that look.
   size: small thumbnails at a fixed width; null: exactly what applying the look gives (your width, crop, captions,
   edits, the current frame and its changes over time), drawn smaller to fit the card */
async function renderLookCards(cards, size, owner) {
  const token = owner.token = {};
  const s = App.src;
  let d = s && s.kind !== 'text' ? currentDrawable() : null;
  if (!d) { const c = demoCanvas(); d = [c, c.width, c.height]; }
  const live = () => owner.token === token && App.src === s;   // not superseded, source not replaced
  for (const card of cards) {
    if (!live()) return;
    const ls = lookSettings(card.dataset.look); if (!ls) continue;
    const exact = !size, St = exact ? Object.assign({}, settingsAt(curTime()), ls) : Object.assign({}, S, ls, size, { bgFade: 0, margin: 0 }), canvas = card.querySelector('canvas');
    const draw = raw => {
      if (!live()) return;
      try {
        const res = exact ? withOverlay(raw, St) : raw, scale = exact ? Math.min(1, 560 / pictureSize(res.cols, res.rows, St, 1)[0]) : 1;
        renderResult(res, St, canvas, scale); card._res = res;
      } catch (e) { console.warn(e); }
    };
    try {
      const memo = peekResult(d[0], d[1], d[2], St);
      if (memo || !Pool.size()) draw(memo || convertRaw(d[0], d[1], d[2], St));
      else {   // the cards convert on the workers, all at once; only the pictures are drawn here
        const key = memoKey(d[0], d[1], d[2], St);
        convertOnWorker(d[0], d[1], d[2], St).then(res => { if (key) resultCache.set(key, res, resultBytes(res)); draw(res); }, e => console.warn(e));
      }
    } catch (e) { console.warn(e); }
    await nextTick();
  }
}
/* the bigger gallery: every look at a larger size, in a dialog */
function openGallery() {
  const d = $('#galleryDialog'), box = $('#galleryGrid'); box.innerHTML = '';
  const ids = Object.keys(PRESETS).concat(userLooks.map(l => USER_PREFIX + l.name));
  for (const id of ids) {
    const b = document.createElement('button'); b.className = 'look big'; b.dataset.look = id; b.title = 'Apply this look';
    b.innerHTML = '<canvas></canvas><span></span>'; b.querySelector('span').textContent = id.replace(USER_PREFIX, '');
    b.classList.toggle('on', id === App.look);
    b.addEventListener('click', () => { applyPreset(id); d.close(); });
    box.appendChild(b);
  }
  d.showModal(); renderGallery();
}
const renderGallery = () => renderLookCards($$('#galleryGrid .look'), null, renderGallery);
/* folds (details) remember whether you left them open */
function initFold(d) {
  if (!d || d._fold) return; d._fold = true;
  let s = {}; try { s = JSON.parse(localStorage.getItem('textArtStudio.folds') || '{}'); } catch (e) {}
  if (d.dataset.fold in s) d.open = !!s[d.dataset.fold];
  d.addEventListener('toggle', () => {
    let m = {}; try { m = JSON.parse(localStorage.getItem('textArtStudio.folds') || '{}'); } catch (e) {}
    m[d.dataset.fold] = d.open; try { localStorage.setItem('textArtStudio.folds', JSON.stringify(m)); } catch (e) {}
    if (d.open && d.dataset.fold === 'drawing') scheduleLooks();
  });
}
function setTab(t) {
  $$('#leftTabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === t); a11ySync(b); });
  $$('#settings .tab').forEach(sec => { sec.hidden = sec.dataset.tab !== t; });
  setStep(t === 'look' ? 2 : 3);
  try { localStorage.setItem('textArtStudio.tab', t); } catch (e) {}
}
function setStep(n) {
  App.step = n;
  $$('#steps .step').forEach(b => {
    const k = +b.dataset.step;
    b.classList.toggle('cur', k === n);
    b.classList.toggle('done', k < n || (k === 1 && !!App.src));
  });
}
function gotoStep(n) {
  if (n === 1) { $('#fileInput').click(); return; }
  if (isNarrow()) setSheet(n === 4 ? 'export' : 'settings');
  if (n === 2) setTab('look');
  else if (n === 3) setTab('adjust');
  else {
    const p = $('#exportPanel'); p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    p.classList.remove('flash'); void p.offsetWidth; p.classList.add('flash'); setStep(4);
  }
}
function applyGoal() {
  const g = S.exportGoal || 'chat';
  $$('#goalSeg button').forEach(b => b.classList.toggle('on', b.dataset.goal === g));
  $$('#exportBody .xsec').forEach(sec => { sec.hidden = sec.dataset.goal !== g; });
  updateQualityButtons(); scheduleSizeEstimate();
  if (g === 'chat' && App.shareStale) updateShareUI(true);
}
function updateChoices() {
  $$('.choices').forEach(ch => $$('button[data-val]', ch).forEach(b => b.classList.toggle('on', String(S[ch.dataset.choice]) === b.dataset.val)));
}
function setAdvanced(on) {
  document.body.classList.toggle('simple', !on); $('#advToggle').checked = on;
  try { localStorage.setItem('textArtStudio.adv', on ? '1' : '0'); } catch (e) {}
}

/* ---- filmstrip: thumbnails of the frames, click to jump ---- */
const film = { items: [], cur: -1 };
async function buildFilmstrip() {
  const el = $('#filmstrip'), s = App.src, token = buildFilmstrip.token = {};
  el.innerHTML = ''; film.items = []; film.cur = -1;
  if (!s || !(s.kind === 'anim' || s.kind === 'video')) { el.hidden = true; return; }
  el.hidden = false;
  const d = duration(), items = [];
  if (s.kind === 'anim') {
    const n = s.frames.length, step = Math.max(1, Math.ceil(n / 160));
    for (let i = 0; i < n; i += step) items.push({ t: s.frames[i].t0, label: String(i + 1), idx: i });
  } else {
    const n = Math.max(6, Math.min(40, Math.round(d * 2)));
    for (let k = 0; k < n; k++) items.push({ t: d * k / n, label: fmtTime(d * k / n).replace(/\.\d+$/, '') });
  }
  const th = 46, tw = Math.max(20, Math.round(th * s.w / Math.max(1, s.h)));
  for (const it of items) {
    const b = document.createElement('button'); b.className = 'fthumb'; b.title = s.kind === 'anim' ? 'Frame ' + it.label : it.label;
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const i = document.createElement('i'); i.textContent = it.label;
    b.append(c, i); b.addEventListener('click', () => { setPlaying(false); seekTo(it.t + 1e-6); });
    el.appendChild(b); it.el = b; it.c = c;
  }
  film.items = items;
  if (s.kind === 'anim') {
    for (const it of items) if (s.frames[it.idx].bmp) it.c.getContext('2d').drawImage(s.frames[it.idx].bmp, 0, 0, tw, th);
  } else {   // a hidden second video grabs thumbnails without disturbing playback
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = s.url; $('#videoHost').appendChild(v);
    try {
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; setTimeout(res, 5000); });
      for (const it of items) {
        if (buildFilmstrip.token !== token) break;
        await seekVideo(v, it.t);
        if (v.readyState >= 2) it.c.getContext('2d').drawImage(v, 0, 0, tw, th);
      }
    } catch (e) { console.warn('filmstrip', e); }
    v.removeAttribute('src'); v.remove();
  }
  updateFilmstrip(true);
}
function updateFilmstrip(force) {
  if (!film.items.length) return;
  const t = curTime(), [a, b] = trimRange(), trimmed = App.tin != null || App.tout != null;
  let k = 0; for (let i = 0; i < film.items.length; i++) if (film.items[i].t <= t + 1e-6) k = i;
  if (k !== film.cur || force) {
    if (film.items[film.cur]) film.items[film.cur].el.classList.remove('cur');
    film.cur = k; const el = film.items[k].el; el.classList.add('cur');
    const strip = $('#filmstrip'), l = el.offsetLeft - strip.offsetLeft;
    if (l < strip.scrollLeft || l + el.offsetWidth > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = l - strip.clientWidth / 2 + el.offsetWidth / 2;
  }
  if (force || updateFilmstrip.trimSig !== a + '|' + b) {
    updateFilmstrip.trimSig = a + '|' + b;
    for (const it of film.items) it.el.classList.toggle('out', trimmed && (it.t < a - 1e-6 || it.t >= b - 1e-6));
  }
}

function initUI2() {
  loadUserLooks(); buildLooks();
  let all = false; try { all = localStorage.getItem('textArtStudio.allLooks') === '1'; } catch (e) {}
  setAllLooks(all); $('#moreLooks').addEventListener('click', () => setAllLooks(!$('#looks').classList.contains('all')));
  $$('details.fold[data-fold]').forEach(initFold);
  $('#galleryOpen').addEventListener('click', openGallery);
  $('#galleryClose').addEventListener('click', () => $('#galleryDialog').close());
  $('#galleryDialog').addEventListener('close', () => { renderGallery.token = null; });
  $('#btnUndo').addEventListener('click', () => UndoHistory.step(true));
  $('#btnRedo').addEventListener('click', () => UndoHistory.step(false));
  const ld = $('#lookDialog');
  $('#lookCancel').addEventListener('click', () => ld.close());
  const doSave = () => { if (saveUserLook($('#lookName').value)) { ld.close(); toast('Look saved: ' + $('#lookName').value.trim()); } else $('#lookName').focus(); };
  $('#lookSave').addEventListener('click', doSave);
  $('#lookName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
  UndoHistory.reset();
  $$('#leftTabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('#steps .step').forEach(b => b.addEventListener('click', () => gotoStep(+b.dataset.step)));
  $$('#goalSeg button').forEach(b => b.addEventListener('click', () => { S.exportGoal = b.dataset.goal; saveSettings(); applyGoal(); setStep(4); }));
  $('#exportPanel').addEventListener('pointerdown', () => { if (App.src) setStep(4); });
  $$('.choices').forEach(ch => ch.addEventListener('click', e => { const b = e.target.closest('button[data-val]'); if (b) { App.look = null; markLooks(); applySettings({ [ch.dataset.choice]: b.dataset.val }); } }));
  let adv = false; try { adv = localStorage.getItem('textArtStudio.adv') === '1'; } catch (e) {}
  setAdvanced(adv);
  $('#advToggle').addEventListener('change', e => setAdvanced(e.target.checked));
  const pop = $('#morePop');
  $('#moreBtn').addEventListener('click', e => { e.stopPropagation(); pop.hidden = !pop.hidden; });
  pop.addEventListener('click', () => { pop.hidden = true; });
  document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('.menuwrap')) pop.hidden = true; });
  const help = $('#helpDialog');
  $('#btnHelp').addEventListener('click', () => help.showModal());
  $('#helpClose').addEventListener('click', () => help.close());
  let tab = 'look'; try { tab = localStorage.getItem('textArtStudio.tab') || 'look'; } catch (e) {}
  setTab(['look', 'adjust', 'colour', 'crop'].includes(tab) ? tab : 'look');
  setStep(1);
  updateChoices();
  scheduleLooks();
  try { if (!localStorage.getItem('textArtStudio.seenHelp')) { localStorage.setItem('textArtStudio.seenHelp', '1'); } } catch (e) {}
}

