/* =====================================================================
   Customize the screen: hide the parts you do not use (remembered in this browser).
   Hidden parts stay reachable with Find a tool.
   ===================================================================== */
const SCREEN_PARTS = [
  ['steps', 'The steps bar (1 Open · 2 Pick a look · 3 Adjust · 4 Share)'],
  ['versions', 'Versions (A–D) above the picture'],
  ['edit', 'The ✎ Edit button'],
  ['wipe', 'The Wipe view'],
  ['platform', 'The "In the app" view'],
  ['film', 'The filmstrip of animations and videos'],
  ['guides', 'Guides: character strip and brightness histogram'],
  ['status', 'The status bar at the bottom'],
];
const CUSTOM_KEY = 'textArtStudio.hidden';
function hiddenParts() { try { return new Set(JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]')); } catch (e) { return new Set(); } }
function applyHiddenParts(set = hiddenParts()) { for (const [id] of SCREEN_PARTS) document.body.classList.toggle('hide-' + id, set.has(id)); }
function setPartHidden(id, hide) {
  const s = hiddenParts(); if (hide) s.add(id); else s.delete(id);
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify([...s])); } catch (e) {}
  applyHiddenParts(s);
}
function openCustomize() {
  const box = $('#customList'), hidden = hiddenParts(); box.textContent = '';
  for (const [id, label] of SCREEN_PARTS) {
    const l = document.createElement('label'); l.className = 'chk';
    l.innerHTML = '<input type="checkbox"> <span></span>'; l.lastChild.textContent = label;
    const c = l.firstChild; c.checked = !hidden.has(id); c.addEventListener('change', () => setPartHidden(id, !c.checked));
    box.appendChild(l);
  }
  $('#customDialog').showModal();
}
function initCustomize() {
  applyHiddenParts();
  $('#btnCustomize').addEventListener('click', openCustomize);
  $('#customClose').addEventListener('click', () => $('#customDialog').close());
  $('#customReset').addEventListener('click', () => { try { localStorage.removeItem(CUSTOM_KEY); } catch (e) {} applyHiddenParts(new Set()); openCustomize(); });
}
