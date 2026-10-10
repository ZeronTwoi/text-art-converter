/* =====================================================================
   Character set designer: pick characters (or type them), sorted from light to dense in your font, previewed on
   your picture; use them, or save them under a name (they appear in the character list).
   A set is plain custom characters, so looks and projects carry it.
   ===================================================================== */
const CHAR_GROUPS = [
  ['Letters', 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  ['Digits', '0123456789'],
  ['Symbols', `.,:;'"\`^~-_=+*#%@&$!?|/\\()[]{}<>`],
  ['Blocks & shades', '░▒▓█▀▄▌▐▖▗▘▝▚▞■□▪▫'],
  ['Lines & boxes', '─│┌┐└┘├┤┬┴┼═║╬╱╲╳'],
  ['Dots & shapes', '·•●○◦◉◎◌∙⁘⁙⋅∘★☆✦✧◆◇▲△▼▽'],
  ['Katakana', 'ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ'],
  ['Arrows & math', '←↑→↓↔↕∞≈≠≤≥±×÷√∑∏∂∫Δπσμ'],
];
const CHARSET_STORE = 'textArtStudio.charsets';
const Designer = { chars: new Set(), timer: 0 };
function userCharsets() { try { const a = JSON.parse(localStorage.getItem(CHARSET_STORE) || '[]'); return Array.isArray(a) ? a.filter(x => x && typeof x.name === 'string' && typeof x.chars === 'string') : []; } catch (e) { return []; } }
/* the chosen characters from light to dense in the current font (a space first) */
function designerRamp() {
  const list = [' '].concat([...Designer.chars].filter(c => c !== ' '));
  if (list.length < 2) return list;
  const t = getGlyphTable(list, fontCss(S));
  return list.map((c, i) => [c, t.mean[i]]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
}
function designerRender() {
  const ramp = designerRamp(), strip = $('#csRamp');
  strip.textContent = ''; strip.style.background = S.bg; strip.style.color = S.fg; strip.style.fontFamily = fontCss(S);
  for (const ch of ramp) { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; strip.appendChild(s); }
  $('#csCount').textContent = `${ramp.length - 1} characters`;
  $$('#csGroups button[data-ch]').forEach(b => { const on = Designer.chars.has(b.dataset.ch); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  clearTimeout(Designer.timer);
  Designer.timer = setTimeout(() => {   // the picture with these characters
    const c = $('#csPreview'), s = App.src; let d = s && s.kind !== 'text' ? currentDrawable() : null;
    if (!d) { const dc = demoCanvas(); d = [dc, dc.width, dc.height]; }
    if (ramp.length < 2) { c.width = c.height = 1; return; }
    const St = Object.assign({}, S, { mode: S.mode === 'edge' ? 'edge' : 'ascii', charset: 'custom', customChars: ramp.join(''), sortRamp: false, cols: Math.min(S.cols, 90), margin: 0 });
    try { renderResult(convertRaw(d[0], d[1], d[2], St), St, c, 1); } catch (e) { console.warn(e); }
  }, 120);
}
function openDesigner() {
  Designer.chars = new Set(Array.from(S.charset === 'custom' ? S.customChars : getRamp(S).join('')).filter(c => c !== ' '));
  const box = $('#csGroups');
  if (!box.childElementCount) for (const [name, chars] of CHAR_GROUPS) {
    const g = document.createElement('div'); g.className = 'csgroup';
    g.innerHTML = `<div class="cshead"><b></b><button class="linkbtn" data-all>all</button> <button class="linkbtn" data-none>none</button></div><div class="cschars"></div>`;
    g.querySelector('b').textContent = name;
    for (const ch of Array.from(chars)) { const b = document.createElement('button'); b.className = 'csch'; b.dataset.ch = ch; b.textContent = ch; b.title = uplus(ch.codePointAt(0)); g.querySelector('.cschars').appendChild(b); }
    g.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ch) { if (Designer.chars.has(b.dataset.ch)) Designer.chars.delete(b.dataset.ch); else Designer.chars.add(b.dataset.ch); }
      else for (const ch of Array.from(chars)) { if (b.hasAttribute('data-all')) Designer.chars.add(ch); else Designer.chars.delete(ch); }
      designerRender();
    });
    box.appendChild(g);
  }
  $('#csName').value = ''; $('#csType').value = '';
  $('#csDialog').showModal(); designerRender();
}
function designerUse() {
  const ramp = designerRamp(); if (ramp.length < 2) return toast('Choose at least one character');
  App.look = null; markLooks();
  applySettings({ mode: S.mode === 'ascii' || S.mode === 'edge' ? S.mode : 'ascii', charset: 'custom', customChars: ramp.join(''), sortRamp: false });
  $('#csDialog').close(); toast(`Using ${ramp.length - 1} characters`);
}
function designerSave() {
  const name = $('#csName').value.trim().slice(0, 30), ramp = designerRamp();
  if (!name) { $('#csName').focus(); return toast('Give the set a name'); }
  if (ramp.length < 2) return toast('Choose at least one character');
  const list = userCharsets().filter(x => x.name !== name); list.push({ name, chars: ramp.join('') });
  try { localStorage.setItem(CHARSET_STORE, JSON.stringify(list)); } catch (e) { return toast('This browser cannot store it', 'error'); }
  fillCharsetSelect(); designerUse(); toast(`Saved "${name}": it is in the character list`);
}
/* the character list with your saved sets at the end */
function fillCharsetSelect() {
  const cs = $('#charsetSel'); cs.querySelectorAll('optgroup.user').forEach(g => g.remove());
  const sets = userCharsets(); if (!sets.length) return;
  const g = document.createElement('optgroup'); g.className = 'user'; g.label = 'Your character sets';
  for (const s of sets) { const o = document.createElement('option'); o.value = 'user:' + s.name; o.textContent = s.name; g.appendChild(o); }
  cs.appendChild(g);
}
function initDesigner() {
  fillCharsetSelect();
  // choosing a saved set fills the custom characters (the setting stays 'custom', so looks and projects keep the characters)
  $('#charsetSel').addEventListener('change', e => {
    const v = e.target.value; if (!v.startsWith('user:')) return;
    const s = userCharsets().find(x => 'user:' + x.name === v); if (!s) return;
    e.stopImmediatePropagation(); applySettings({ charset: 'custom', customChars: s.chars, sortRamp: false });
  }, true);
  $('#csOpen').addEventListener('click', openDesigner);
  $('#csType').addEventListener('input', e => { for (const ch of Array.from(e.target.value)) if (ch.trim()) Designer.chars.add(ch); e.target.value = ''; designerRender(); });
  $('#csClear').addEventListener('click', () => { Designer.chars.clear(); designerRender(); });
  $('#csUse').addEventListener('click', designerUse);
  $('#csSave').addEventListener('click', designerSave);
  $('#csCancel').addEventListener('click', () => $('#csDialog').close());
}
