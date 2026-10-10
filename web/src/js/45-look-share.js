/* =====================================================================
   Share looks: a look as a small .textlook file or a link (#look=…). Opening either adds it to your looks and uses it.
   Only look settings travel (style, colours, light, characters), never the picture.
   ===================================================================== */
function lookOnly(o) { const st = {}; for (const k in o || {}) if (k in DEFAULTS && !LOOK_SKIP.has(k) && typeof o[k] === typeof DEFAULTS[k]) st[k] = o[k]; return st; }
const currentLook = () => lookOnly(S);
/* what is shared: only the settings that differ from the defaults (shorter links) */
function lookPayload(name, st) { const d = {}; for (const k in st) if (st[k] !== DEFAULTS[k]) d[k] = st[k]; return { generator: 'Text Art Studio', type: 'look', v: 1, name, settings: d }; }
async function lookLink(name, st) {
  const z = await deflateRaw(new TextEncoder().encode(JSON.stringify(lookPayload(name, st))));
  return location.href.replace(/#.*$/, '') + '#look=' + b64url(z);
}
function saveLookFile(name, st) {
  download(new Blob([JSON.stringify(lookPayload(name, st), null, 1)], { type: 'application/json' }), (name.replace(/[\\/:*?"<>|]+/g, '_') || 'look') + '.textlook');
}
/* adds a shared look to yours (once: the same settings are not added twice) and uses it */
function addSharedLook(p) {
  if (!p || p.type !== 'look' || typeof p.name !== 'string' || !p.settings || typeof p.settings !== 'object') throw new Error('not a Text Art Studio look');
  const settings = Object.assign(lookOnly(DEFAULTS), lookOnly(p.settings)), base = p.name.trim().slice(0, 34) || 'Shared look';
  const same = userLooks.find(l => Object.keys(settings).every(k => l.settings[k] === settings[k]));
  let name = same && same.name;
  if (!name) { name = base; for (let n = 2; userLooks.some(l => l.name === name); n++) name = `${base} (${n})`; userLooks.push({ name, settings }); storeUserLooks(); buildLooks(); }
  applyPreset(USER_PREFIX + name); scheduleLooks();
  toast(same ? `You already have this look: ${name}` : `Look added to your looks: ${name}`);
  return name;
}
async function openLookLink(hash) {
  const m = /^#look=([A-Za-z0-9_-]+)$/.exec(hash || ''); if (!m) return false;
  try { addSharedLook(JSON.parse(new TextDecoder().decode(await inflateRaw(unb64url(m[1]))))); history.replaceState(null, '', location.href.replace(/#.*$/, '')); return true; }
  catch (e) { toast('This look link could not be opened: ' + e.message, 'error'); return false; }
}
async function openLookFile(file) {
  try { addSharedLook(JSON.parse(await file.text())); } catch (e) { toast('Could not open the look: ' + e.message, 'error'); }
}
function initLookShare() {
  const name = () => $('#lookName').value.trim().slice(0, 40) || 'Shared look';
  $('#lookLink').addEventListener('click', async () => {
    if (!canDeflate()) return toast('This browser cannot make links', 'error');
    const link = await lookLink(name(), currentLook()); $('#lookDialog').close();
    copyOrShow(link, 'Look link copied. Whoever opens it gets this look (not your picture)' + (servedOnWeb() ? '' : '. While the page is only on this computer, the link opens here only'));
  });
  $('#lookFile').addEventListener('click', () => { saveLookFile(name(), currentLook()); $('#lookDialog').close(); toast('Look saved as a file. Open it (or drop it) in Text Art Studio to add it'); });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#look=')) openLookLink(location.hash); });
  if (location.hash.startsWith('#look=')) openLookLink(location.hash);
}
