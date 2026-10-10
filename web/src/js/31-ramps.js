/* =====================================================================
   Settings that change over time (animations and videos): ramps from one value to another across the
   trim range, e.g. brightness fading in or outlines growing. Only settings that keep the picture size.
   ===================================================================== */
const RAMP_KEYS = {
  brightness: { name: 'Brightness', min: -1, max: 1 }, contrast: { name: 'Contrast', min: -1, max: 0.95 }, gamma: { name: 'Gamma', min: 0.2, max: 3 },
  saturation: { name: 'Saturation', min: 0, max: 3 }, threshold: { name: 'Threshold', min: 0.05, max: 0.95 }, outline: { name: 'Outlines', min: 0, max: 1 },
  fill: { name: 'Shading', min: 0, max: 1 }, bgFade: { name: 'Hide plain background', min: 0, max: 1 }, localContrast: { name: 'Depth', min: 0, max: 1 },
  sharpen: { name: 'Sharpen', min: 0, max: 2 }, edge: { name: 'Edge boost', min: 0, max: 1 },
};
const RAMP_EASES = { linear: 'Steady', smooth: 'Smooth (ease in and out)', back: 'There and back (loops)' };
const Ramps = { list: [] };   // { key, from, to, ease }
const rampEase = (e, p) => e === 'smooth' ? p * p * (3 - 2 * p) : e === 'back' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * p) : p;
const rampsActive = s => Ramps.list.length > 0 && !!s && (s.kind === 'anim' || s.kind === 'video');
let rampMemo = new Map();
/* the settings at time t (seconds) of the open animation / video: yours, with the ramps applied */
function settingsAt(t) {
  if (!rampsActive(App.src)) return S;
  const [a, b] = trimRange(), p = b > a ? clamp((t - a) / (b - a), 0, 1) : 0;
  const key = p.toFixed(5) + '|' + rampSig();
  let St = rampMemo.get(key);
  if (!St) {
    St = Object.assign({}, S);
    for (const r of Ramps.list) { const k = RAMP_KEYS[r.key]; if (k) St[r.key] = Math.round(clamp(r.from + (r.to - r.from) * rampEase(r.ease, p), k.min, k.max) * 1e4) / 1e4; }
    if (rampMemo.size > 400) rampMemo.clear();
    rampMemo.set(key, St);
  }
  return St;
}
let rampSigCache = null;
function rampSig() { if (rampSigCache) return rampSigCache; return (rampSigCache = JSON.stringify(Ramps.list) + '|' + convertSig(S)); }
function rampsChanged() { rampSigCache = null; rampMemo.clear(); App.dirty = true; Prefetch.clear(); scheduleSessionSave(); }
/* the time of an export frame */
const frameTime = f => f.t || 0;
const frameSettings = f => settingsAt(frameTime(f));
function buildRampsUI() {
  const box = $('#rampList'); box.textContent = '';
  Ramps.list.forEach((r, i) => {
    const k = RAMP_KEYS[r.key], row = document.createElement('div'); row.className = 'ramprow';
    row.innerHTML = `<select aria-label="Setting">${Object.entries(RAMP_KEYS).map(([key, v]) => `<option value="${key}"${key === r.key ? ' selected' : ''}>${v.name}</option>`).join('')}</select>
      <label>from <input type="number" step="0.05" value="${r.from}" aria-label="From"></label><label>to <input type="number" step="0.05" value="${r.to}" aria-label="To"></label>
      <select aria-label="How it changes">${Object.entries(RAMP_EASES).map(([e, n]) => `<option value="${e}"${e === r.ease ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn icon" aria-label="Remove this change" title="Remove">✕</button>`;
    const [sel, ease] = row.querySelectorAll('select'), [from, to] = row.querySelectorAll('input');
    sel.addEventListener('change', () => { r.key = sel.value; const kk = RAMP_KEYS[r.key]; r.from = S[r.key]; r.to = clamp(S[r.key] + (kk.max - kk.min) / 3, kk.min, kk.max); buildRampsUI(); rampsChanged(); });
    const num = (inp, prop) => inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (isFinite(v)) { r[prop] = clamp(v, RAMP_KEYS[r.key].min, RAMP_KEYS[r.key].max); rampsChanged(); } });
    num(from, 'from'); num(to, 'to');
    ease.addEventListener('change', () => { r.ease = ease.value; rampsChanged(); });
    row.querySelector('button').addEventListener('click', () => { Ramps.list.splice(i, 1); buildRampsUI(); rampsChanged(); });
    box.appendChild(row);
  });
  $('#rampNote').textContent = Ramps.list.length ? 'Plays from the start to the end of the trim range, and every animated export follows it.' : 'Nothing changes over time yet.';
}
function addRamp(key = 'brightness') {
  const used = new Set(Ramps.list.map(r => r.key)), k = RAMP_KEYS[key] && !used.has(key) ? key : Object.keys(RAMP_KEYS).find(x => !used.has(x));
  if (!k) return;
  const d = RAMP_KEYS[k];
  Ramps.list.push({ key: k, from: S[k], to: Math.round(clamp(k === 'brightness' ? S[k] - 0.6 : S[k] + (d.max - d.min) / 3, d.min, d.max) * 100) / 100, ease: 'linear' });
  buildRampsUI(); rampsChanged();
}
function initRamps() {
  $('#rampAdd').addEventListener('click', () => addRamp());
  buildRampsUI();
}
