/* =====================================================================
   Languages. The page is written in English; another language is a dictionary English → that language, packed
   (compressed) in this file and unpacked only when it is chosen. A translator walks the page (text, titles,
   placeholders, labels; short formatted paragraphs as a whole) and watches it for new text (toasts, panels that
   are rebuilt). Numbers inside sentences are kept: "Frame {0} of {1}". In English nothing runs.
   New English text: add it to every src/i18n/<lang>.json (numbers as {0}, {1}…; names inside sentences as {0} too).
   Text that is missing stays English; uitest "Languages: nearly everything is translated" shows how much is.
   ===================================================================== */
const LANGS = { en: 'English', tr: 'Türkçe', de: 'Deutsch', es: 'Español', ru: 'Русский', ja: '日本語', zh: '中文' };
const LANG_KEYS = '@@LANG_KEYS@@';   // the English sentences, once
const LANG_DATA = { tr: '@@LANG_tr@@', de: '@@LANG_de@@', es: '@@LANG_es@@', ru: '@@LANG_ru@@', ja: '@@LANG_ja@@', zh: '@@LANG_zh@@' };
const LANG_KEY = 'textArtStudio.lang';
const I18N = { lang: 'en', dict: new Map(), pats: [], cache: new Map(), orig: new WeakMap(), obs: null, keys: null };
/* never translated: the art itself, what you type, code */
const I18N_SKIP = 'script,style,textarea,pre,code,canvas,svg,[translate="no"],.mono,.cschars,#ramp,#csRamp,#toolResults .muted.k';
const I18N_ATTRS = ['title', 'placeholder', 'aria-label', 'label'];
const I18N_INLINE = new Set(['B', 'I', 'EM', 'STRONG', 'KBD', 'SMALL', 'BR', 'A', 'U', 'SUP', 'SUB']);
const normText = s => s.replace(/\s+/g, ' ').trim();
/* numbers and colour codes inside sentences: kept as they are, the rest translated */
const I18N_NUM = /#[0-9a-fA-F]{3,8}\b|\b(?=[0-9a-f]*\d)[0-9a-f]{6}\b|\d+(?:[.,:]\d+)*/g;
const hasWords = s => /\p{L}{2}/u.test(s);
/* a short formatted paragraph (text with <b>, <kbd>, <a href>… only) is translated as one piece */
function isHtmlUnit(el) {
  let inline = 0, words = false;
  for (const c of el.childNodes) {
    if (c.nodeType === 3) { if (hasWords(c.data)) words = true; continue; }
    if (c.nodeType !== 1) continue;
    if (!I18N_INLINE.has(c.tagName) || c.id || [...c.attributes].some(a => !/^(href|class|title|target|rel)$/.test(a.name)) || c.children.length) return false;
    inline++;
  }
  return inline > 0 && words;
}
/* every translatable piece under root: fn(kind, node, attr) with kind 'text' | 'attr' | 'html' */
function i18nWalk(root, fn) {
  const visit = el => {
    // a piece already translated is visited even if it is one letter now (e.g. 色)
    if (el.nodeType === 3) { if ((hasWords(el.data) || I18N.orig.has(el)) && !(el.parentElement && el.parentElement.closest(I18N_SKIP))) fn('text', el); return; }
    if (el.nodeType !== 1 || el.matches(I18N_SKIP)) return;
    const o = I18N.orig.get(el);
    for (const a of I18N_ATTRS) if (el.hasAttribute(a) && (hasWords(el.getAttribute(a)) || (o && o[a]))) fn('attr', el, a);
    if (o && o.html) { fn('html', el); return; }
    if (el !== document.body && isHtmlUnit(el)) { fn('html', el); return; }
    for (const c of el.childNodes) visit(c);
  };
  visit(root);
}
/* the translation of one English string ('' stays ''); unknown strings stay English */
function tr(s) {
  if (I18N.lang === 'en' || !s || !hasWords(s)) return s;
  let out = I18N.cache.get(s);
  if (out === undefined) { out = trCore(s); if (I18N.cache.size > 4000) I18N.cache.clear(); I18N.cache.set(s, out); }
  return out;
}
function trLookup(core) {
  const D = I18N.dict; let t = D.get(core);
  if (t != null) return t;
  const nums = [], g = core.replace(I18N_NUM, x => `{${nums.push(x) - 1}}`);
  if (nums.length && (t = D.get(g)) != null) return t.replace(/\{(\d+)\}/g, (_, i) => nums[+i] == null ? '' : nums[+i]);
  for (const p of I18N.pats) { const r = p.re.exec(core); if (r) return p.out.replace(/\{(\d+)\}/g, (_, i) => r[+i + 1] == null ? '' : tr(r[+i + 1])); }
  return null;
}
function trCore(s) {
  // leading symbols (▶ 🔗 ＋ …) and trailing arrows stay around the translated words
  const m = /^(\s*[^\p{L}\p{N}"'(¿¡]*\s*)([\s\S]*?)(\s*[▾▴]?\s*)$/u.exec(s);
  const [, pre, core0, post] = m, core = normText(core0);
  const t = trLookup(core);
  return t == null ? s : pre + t + post;
}
/* translates (or, in English, restores) one piece of the page */
function i18nApply(kind, node, attr) {
  const key = kind === 'attr' ? attr : kind;
  let o = I18N.orig.get(node); if (!o) I18N.orig.set(node, o = {});
  const cur = kind === 'text' ? node.data : kind === 'html' ? node.innerHTML : node.getAttribute(attr);
  let rec = o[key];
  if (!rec || cur !== rec.shown) rec = o[key] = { en: cur, shown: cur };   // new or changed by the app: that is the English
  const want = I18N.lang === 'en' ? rec.en : kind === 'html' ? (trLookup(normText(rec.en)) || rec.en) : tr(rec.en);
  if (want === cur) return;
  if (kind === 'text') node.data = want; else if (kind === 'html') node.innerHTML = want; else node.setAttribute(attr, want);
  rec.shown = kind === 'text' ? node.data : kind === 'html' ? node.innerHTML : node.getAttribute(attr);   // as the browser stored it
}
function i18nPage(root = document.body) { i18nWalk(root, i18nApply); }
function i18nObserve(on) {
  if (!on) { if (I18N.obs) I18N.obs.disconnect(); I18N.obs = null; return; }
  if (I18N.obs) return;
  I18N.obs = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'childList') { for (const n of m.addedNodes) if (n.isConnected) { const p = n.parentElement; if (p && p.closest(I18N_SKIP)) continue; if (p && p !== document.body && isHtmlUnit(p)) i18nApply('html', p); else i18nWalk(n, i18nApply); } }
      else if (m.type === 'characterData') { const n = m.target, p = n.parentElement; if (p && !p.closest(I18N_SKIP) && hasWords(n.data)) { if (p !== document.body && isHtmlUnit(p)) i18nApply('html', p); else i18nApply('text', n); } }
      else if (m.type === 'attributes') { const el = /** @type {Element} */ (m.target); if (!el.closest(I18N_SKIP) && hasWords(el.getAttribute(m.attributeName) || '')) i18nApply('attr', el, m.attributeName); }
    }
  });
  I18N.obs.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: I18N_ATTRS });
}
async function loadLangDict(lang) {
  const b64 = LANG_DATA[lang]; if (!b64 || b64.startsWith('@@')) throw new Error('no translation for ' + lang);
  const unpack = async s => JSON.parse(new TextDecoder().decode(await inflateRaw(base64ToBytes(s))));
  const keys = I18N.keys || (I18N.keys = await unpack(LANG_KEYS)), values = await unpack(b64);
  const dict = new Map(), pats = [];
  keys.forEach((k, i) => { if (values[i] != null) dict.set(k, values[i]); });
  for (const [en, t] of dict) if (/\{\d+\}/.test(en) && en.replace(/\{\d+\}/g, '').replace(/[^\p{L}]/gu, '').length >= 3) {
    const re = new RegExp('^' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\d+)\\\}/g, '(.*?)') + '$', 's');
    pats.push({ re, out: t, n: en.length });
  }
  pats.sort((a, b) => b.n - a.n);
  return { dict, pats };
}
async function setLanguage(lang, quiet) {
  if (!LANGS[lang]) lang = 'en';
  if (lang !== 'en') { try { Object.assign(I18N, await loadLangDict(lang)); } catch (e) { console.warn(e); if (!quiet) toast('This language could not be loaded', 'error'); lang = 'en'; } }
  I18N.lang = lang; I18N.cache.clear();
  if (lang === 'en') { I18N.dict = new Map(); I18N.pats = []; }
  document.documentElement.lang = lang;
  i18nObserve(false); i18nPage(); if (lang !== 'en') i18nObserve(true);
  const sel = $('#langSel'); if (sel) sel.value = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
}
/* the language to start in: the one you chose, else your browser's (if there is a translation), else English */
function startLanguage() {
  let l = null; try { l = localStorage.getItem(LANG_KEY); } catch (e) {}
  if (l && LANGS[l]) return l;
  const nav = (navigator.languages || [navigator.language || 'en']).map(x => String(x).slice(0, 2).toLowerCase()).find(x => LANGS[x]);
  return nav || 'en';
}
function initI18n() {
  const nativeConfirm = window.confirm.bind(window);
  window.confirm = msg => nativeConfirm(tr(String(msg)));   // the browser's own question boxes too
  const sel = $('#langSel');
  sel.innerHTML = Object.entries(LANGS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  sel.addEventListener('change', () => setLanguage(sel.value));
  const l = /#(selftest|equiv|uitest|bench|exp)/.test(location.hash) ? 'en' : startLanguage();
  sel.value = l;
  if (l !== 'en') setLanguage(l, true);
}
