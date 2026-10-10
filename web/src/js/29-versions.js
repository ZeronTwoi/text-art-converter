/* =====================================================================
   Versions (A/B…): keep up to four sets of settings and flip between them on the same picture
   ===================================================================== */
const VERSION_SKIP = new Set(['calib', 'exportGoal', 'platform', 'shareOptimize', 'shareTarget', 'shareSplit', 'shareColor', 'shareTheme']);
const Versions = { list: [] };   // { name: 'A', settings }
function versionSnap() { const o = {}; for (const k in DEFAULTS) if (!VERSION_SKIP.has(k)) o[k] = S[k]; return o; }
const versionIsCurrent = v => Object.keys(v.settings).every(k => v.settings[k] === S[k]);
function keepVersion() {
  if (!App.src) return toast('Open a picture first');
  const same = Versions.list.find(versionIsCurrent); if (same) return toast(`These settings are already version ${same.name}`);
  if (Versions.list.length >= 4) return toast('Four versions at most: delete one first (✕ on it)', 'error');
  const name = 'ABCD'.split('').find(n => !Versions.list.some(v => v.name === n));
  Versions.list.push({ name, settings: versionSnap() });
  Versions.list.sort((a, b) => a.name.localeCompare(b.name));
  buildVersions(); scheduleSessionSave();
  toast(`Kept as version ${name}. Change anything, then click ${name} to come back`);
}
function applyVersion(name) {
  const v = Versions.list.find(x => x.name === name); if (!v) return;
  endPeek(true); History.commit(); applySettings(Object.assign({}, v.settings)); History.commit(); App.look = null; markLooks(); markVersions();
  toast('Version ' + name);
}
function deleteVersion(name) { Versions.list = Versions.list.filter(v => v.name !== name); endPeek(); buildVersions(); scheduleSessionSave(); }
function markVersions() { $$('#versions .ver').forEach(b => { const v = Versions.list.find(x => x.name === b.dataset.ver); b.classList.toggle('on', !!v && versionIsCurrent(v)); }); }
function buildVersions() {
  const box = $('#verList'); box.textContent = '';
  for (const v of Versions.list) {
    const b = document.createElement('button'); b.className = 'ver'; b.dataset.ver = v.name;
    b.title = `Version ${v.name}: click to switch to it (key ${'ABCD'.indexOf(v.name) + 1}), point at it to preview`;
    b.innerHTML = `<canvas width="44" height="28"></canvas><b>${v.name}</b><i class="vdel" role="button" aria-label="Delete version ${v.name}" title="Delete version ${v.name}">✕</i>`;
    b.addEventListener('click', e => { if (e.target.classList.contains('vdel')) { e.stopPropagation(); deleteVersion(v.name); } else applyVersion(v.name); });
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') startPeekWith(Object.assign({}, S, v.settings), 'version ' + v.name); });
    b.addEventListener('pointerleave', () => endPeek());
    box.appendChild(b);
  }
  $('#versions').classList.toggle('empty', !Versions.list.length);
  markVersions(); renderVersionThumbs();
}
/* each version's small picture: the current frame in that version */
function renderVersionThumbs() {
  const s = App.src; let d = s && s.kind !== 'text' ? currentDrawable() : null;
  for (const b of $$('#versions .ver')) {
    const v = Versions.list.find(x => x.name === b.dataset.ver), c = b.querySelector('canvas'); if (!v) continue;
    try {
      const St = Object.assign({}, S, v.settings, { cols: 40, fontSize: 3, margin: 0 });
      const r = s && s.kind === 'text' ? textResultRaw(s.text, St, s.ansi) : d ? convertRaw(d[0], d[1], d[2], St) : null;
      if (r) { const t = document.createElement('canvas'); renderResult(r, St, t, 1); const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); const k = Math.min(c.width / t.width, c.height / t.height); g.drawImage(t, (c.width - t.width * k) / 2, (c.height - t.height * k) / 2, t.width * k, t.height * k); }
    } catch (e) { console.warn(e); }
  }
}
function initVersions() {
  $('#verAdd').addEventListener('click', keepVersion);
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-4]$/.test(e.key) || Edit.on) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('dialog[open]')) return;
    const v = Versions.list.find(x => x.name === 'ABCD'[+e.key - 1]); if (v) { e.preventDefault(); applyVersion(v.name); }
  });
  buildVersions();
}
