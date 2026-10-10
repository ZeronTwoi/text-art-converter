/* =====================================================================
   Continue where you left off: the open picture with everything done to it is kept in this browser
   (IndexedDB). The picture is stored once per picture; settings, edits, mask and trim a moment after
   each change. On the next visit the start screen offers to continue. More → Forget removes it.
   ===================================================================== */
const SESSION_MAX_BYTES = 400e6;   // bigger sources (long videos) are not kept
const Session = { timer: 0, srcId: 0, saving: false, again: false, off: false };
const sessionIds = new WeakMap(); let sessionIdNext = 1;
function sessionDB() {
  if (sessionDB.p) return sessionDB.p;
  sessionDB.p = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
    const r = indexedDB.open('textArtStudio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  sessionDB.p.catch(() => {});
  return sessionDB.p;
}
async function idb(mode, fn) {
  const db = await sessionDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', mode), st = tx.objectStore('kv'), out = fn(st);
    tx.oncomplete = () => res(out && out.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
}
function scheduleSessionSave(ms = 1200) {
  if (Session.off || !App.src || App.src.kind === 'webcam' || /#(selftest|equiv|uitest|bench|exp)/.test(location.hash)) return;
  clearTimeout(Session.timer); Session.timer = setTimeout(sessionSave, ms);
}
async function sessionSave() {
  if (Session.saving) { Session.again = true; return; }
  const s = App.src; if (!s || s.kind === 'webcam' || App.exporting || (s.kind === 'anim' && s.complete === false)) { if (s) scheduleSessionSave(2000); return; }
  Session.saving = true;
  try {
    let id = sessionIds.get(s); if (!id) { id = Date.now() + '-' + sessionIdNext++; sessionIds.set(s, id); }
    const { meta, files } = await projectParts(Session.srcId !== id);
    const state = { meta, srcId: id, savedAt: Date.now(), files: {} };
    let source = null, size = 0;
    for (const f of files) {
      if (f.source) { source = source || { srcId: id, files: {} }; source.files[f.name] = f.blob || f.data; size += (f.blob || f.data).size || (f.blob || f.data).length; }
      else state.files[f.name] = f.data;
    }
    if (size > SESSION_MAX_BYTES) { await idb('readwrite', st => { st.delete('state'); st.delete('source'); }); Session.srcId = id; return; }
    await idb('readwrite', st => { if (source) st.put(source, 'source'); st.put(state, 'state'); });
    if (source) Session.srcId = id;
  } catch (e) { console.warn('session not saved:', e && e.message); }
  finally { Session.saving = false; if (Session.again) { Session.again = false; scheduleSessionSave(300); } }
}
async function sessionLoad() {
  try {
    const [state, source] = await Promise.all([idb('readonly', st => st.get('state')), idb('readonly', st => st.get('source'))]);
    if (!state || !state.meta) return null;
    if (state.meta.source.kind !== 'text' && !state.meta.source.demo && (!source || source.srcId !== state.srcId)) return null;
    return { state, source };
  } catch (e) { return null; }
}
async function sessionForget(quiet) {
  clearTimeout(Session.timer); Session.srcId = 0;
  try { await idb('readwrite', st => { st.delete('state'); st.delete('source'); }); } catch (e) {}
  $('#resumeBox').hidden = true;
  if (!quiet) toast('Forgotten: this browser no longer keeps your last picture');
}
async function sessionResume(saved) {
  const { state, source } = saved, files = Object.assign({}, source ? source.files : {}, state.files);
  $('#resumeBox').hidden = true;
  showProgress('Opening your last picture', true);
  try {
    const ok = await openProjectParts(state.meta, name => files[name]);
    if (ok) { sessionIds.set(App.src, state.srcId); Session.srcId = state.srcId; toast('Welcome back: everything is as you left it'); }
  } finally { hideProgress(); }
}
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(); };
async function initSession() {
  $('#btnForget').addEventListener('click', () => sessionForget(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && Session.timer) { clearTimeout(Session.timer); sessionSave(); } });
  if (location.hash && location.hash !== '#') return;   // tests and demos start clean
  const saved = await sessionLoad();
  if (!saved || App.src) return;
  const m = saved.state.meta, box = $('#resumeBox');
  $('#resumeName').textContent = m.source.name || 'your picture';
  $('#resumeWhen').textContent = ago(saved.state.savedAt);
  box.hidden = false;
  $('#resumeGo').onclick = () => sessionResume(saved);
  $('#resumeNo').onclick = () => sessionForget(true);
}
