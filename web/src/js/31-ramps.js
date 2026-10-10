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
const Ramps = { list: [] };   // { key, from, to, ease, t0, t1 } — t0/t1 in seconds; null means the trim start / end
const rampEase = (e, p) => e === 'smooth' ? p * p * (3 - 2 * p) : e === 'back' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * p) : p;
const rampsActive = s => Ramps.list.length > 0 && !!s && (s.kind === 'anim' || s.kind === 'video');
let rampMemo = new Map();
/* how far along (0…1) ramp r is at time t, inside its own start/end window */
function rampProgress(r, t, a, b) {
  const r0 = r.t0 == null ? a : r.t0, r1 = r.t1 == null ? b : r.t1;
  return r1 > r0 ? clamp((t - r0) / (r1 - r0), 0, 1) : (t >= r1 ? 1 : 0);
}
/* the settings at time t (seconds) of the open animation / video: yours, with the ramps applied */
function settingsAt(t) {
  if (!rampsActive(App.src)) return S;
  const [a, b] = trimRange(), ps = Ramps.list.map(r => rampProgress(r, t, a, b));
  const key = ps.map(p => p.toFixed(5)).join() + '|' + rampSig();
  let St = rampMemo.get(key);
  if (!St) {
    St = Object.assign({}, S);
    Ramps.list.forEach((r, i) => { const k = RAMP_KEYS[r.key]; if (k) St[r.key] = Math.round(clamp(r.from + (r.to - r.from) * rampEase(r.ease, ps[i]), k.min, k.max) * 1e4) / 1e4; });
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
  const [ta, tb] = App.src && (App.src.kind === 'anim' || App.src.kind === 'video') ? trimRange() : [0, 0];
  Ramps.list.forEach((r, i) => {
    const k = RAMP_KEYS[r.key], row = document.createElement('div'); row.className = 'ramprow';
    row.innerHTML = `<select aria-label="Setting">${Object.entries(RAMP_KEYS).map(([key, v]) => `<option value="${key}"${key === r.key ? ' selected' : ''}>${v.name}</option>`).join('')}</select>
      <select aria-label="How it changes">${Object.entries(RAMP_EASES).map(([e, n]) => `<option value="${e}"${e === r.ease ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <label>from <input type="number" step="0.05" value="${r.from}" aria-label="From"></label><label>to <input type="number" step="0.05" value="${r.to}" aria-label="To"></label>
      <button class="btn icon rx" aria-label="Remove this change" title="Remove">✕</button>
      <label class="rtime">start <input type="number" min="0" step="0.1" value="${r.t0 == null ? '' : r.t0}" placeholder="${ta.toFixed(1)}" title="When this change starts (seconds). Empty: the start of the trim range" aria-label="Start (seconds)"> s</label>
      <label class="rtime">end <input type="number" min="0" step="0.1" value="${r.t1 == null ? '' : r.t1}" placeholder="${tb.toFixed(1)}" title="When this change ends (seconds). Empty: the end of the trim range" aria-label="End (seconds)"> s</label>`;
    const [sel, ease] = row.querySelectorAll('select'), [from, to, t0i, t1i] = row.querySelectorAll('input');
    sel.addEventListener('change', () => { r.key = sel.value; const kk = RAMP_KEYS[r.key]; r.from = S[r.key]; r.to = clamp(S[r.key] + (kk.max - kk.min) / 3, kk.min, kk.max); buildRampsUI(); rampsChanged(); });
    const num = (inp, prop) => inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (isFinite(v)) { r[prop] = clamp(v, RAMP_KEYS[r.key].min, RAMP_KEYS[r.key].max); rampsChanged(); } });
    num(from, 'from'); num(to, 'to');
    const sec = (inp, prop) => inp.addEventListener('input', () => { const v = parseFloat(inp.value); r[prop] = isFinite(v) ? Math.max(0, v) : null; rampsChanged(); });
    sec(t0i, 't0'); sec(t1i, 't1');
    ease.addEventListener('change', () => { r.ease = ease.value; rampsChanged(); });
    row.querySelector('button').addEventListener('click', () => { Ramps.list.splice(i, 1); buildRampsUI(); rampsChanged(); });
    box.appendChild(row);
  });
  $('#rampSum').textContent = Ramps.list.length ? `${Ramps.list.length} change${Ramps.list.length > 1 ? 's' : ''} while it plays` : 'animations & videos';
  if (Ramps.list.length) $('#rampSum').closest('details').open = true;
  $('#rampNote').textContent = Ramps.list.length ? 'Each change runs in its own start–end window (empty: the whole trim range), and every animated export follows it.' : 'Nothing changes over time yet.';
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
