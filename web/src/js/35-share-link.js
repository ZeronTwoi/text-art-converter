/* =====================================================================
   Share as a link: the current text art (with its colours) packed into the address itself,
   index.html#art=…, compressed. Opening the link shows it; nothing is sent anywhere.
   ===================================================================== */
const b64url = u8 => bytesToBase64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
/* the link of the current result */
async function artLink(res) {
  const colour = !res.uniform;
  const payload = { v: 1, a: colour ? resultANSI(res) : resultText(res), c: colour,
    s: { fg: S.fg, bg: S.bg, bgMode: S.bgMode, fontFamily: S.fontFamily, customFont: S.customFont, charAspect: S.charAspect, fontSize: S.fontSize, margin: S.margin } };
  const z = await deflateRaw(new TextEncoder().encode(JSON.stringify(payload)));
  return location.href.replace(/#.*$/, '') + '#art=' + b64url(z);
}
async function actCopyLink() {
  if (!requireRes()) return;
  if (!canDeflate()) return toast('This browser cannot make links', 'error');
  const link = await artLink(App.res), n = link.length;
  await copyOrShow(link, `Link copied (${n.toLocaleString()} characters)` +
    (n > 2000 ? '. Too long for most chat messages: fewer characters or one colour makes it shorter' : '') +
    (servedOnWeb() ? '' : '. While the page is only on this computer, the link opens here only'));
}
/* opens the art of an #art= link; true if there was one */
async function openArtLink(hash) {
  const m = /^#art=([A-Za-z0-9_-]+)$/.exec(hash || ''); if (!m) return false;
  try {
    const p = JSON.parse(new TextDecoder().decode(await inflateRaw(unb64url(m[1]))));
    if (!p || p.v !== 1 || typeof p.a !== 'string') throw new Error('not a Text Art Studio link');
    const st = {}; for (const k in p.s || {}) if (k in DEFAULTS && typeof p.s[k] === typeof DEFAULTS[k]) st[k] = p.s[k];
    if (p.c) { const a = ansiParse(p.a, 0); st.colorMode = 'color'; applySettings(st); setTextSource(ansiPlain(a), 'shared-art.txt', a); }
    else { st.colorMode = 'mono'; applySettings(st); setTextSource(p.a, 'shared-art.txt'); }
    toast('Opened shared text art');
    return true;
  } catch (e) { toast('This link could not be opened: ' + e.message, 'error'); return false; }
}
function initShareLink() {
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#art=')) openArtLink(location.hash); });
}
