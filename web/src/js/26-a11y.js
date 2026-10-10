/* =====================================================================
   Accessibility: names for every control, toggles and tabs that say whether they are on, keyboard tabs,
   the picture described for screen readers
   ===================================================================== */
const A11Y_TOGGLES = '.choices button[data-val], .mode, .look[data-look], #goalSeg button, #viewSeg button, .qseg button, #maskBrushes button, #maskHardness button, #editTools button, .seg2 button';
/* the visible label of a control that is not linked to it (a label next to it in its .row) */
function a11yNameControls(root = document) {
  for (const el of $$('input, select, textarea', root)) {
    if (el.type === 'hidden' || el.type === 'file') continue;
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label')) continue;
    if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) continue;
    const row = el.closest('.row'), lab = row && row.querySelector(':scope > label, :scope > .lbl');
    let name = lab ? Array.from(lab.childNodes).filter(n => !(n.nodeType === 1 && (n.tagName === 'OUTPUT' || n.hidden))).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim() : '';
    if (!name) name = el.title || el.placeholder || '';
    if (name) el.setAttribute('aria-label', name);
  }
}
function a11ySync(el) {
  if (el.matches('#leftTabs button')) { const on = el.classList.contains('on'); el.setAttribute('aria-selected', on); el.tabIndex = on ? 0 : -1; }
  else if (el.matches('#steps .step')) { if (el.classList.contains('cur')) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); }
  else if (el.matches(A11Y_TOGGLES)) el.setAttribute('aria-pressed', el.classList.contains('on'));
}
const a11yAll = root => { for (const el of $$(A11Y_TOGGLES + ', #leftTabs button, #steps .step', root)) a11ySync(el); };
function initA11y() {
  a11yNameControls(); a11yAll(document);
  // tabs: arrow keys move between them
  const tabs = $$('#leftTabs button');
  tabs.forEach(b => {
    const sec = $(`#settings .tab[data-tab="${b.dataset.tab}"]`);
    sec.id = sec.id || 'tab-' + b.dataset.tab; b.id = b.id || 'tabbtn-' + b.dataset.tab;
    sec.setAttribute('role', 'tabpanel'); sec.setAttribute('aria-labelledby', b.id); b.setAttribute('aria-controls', sec.id);
  });
  $('#leftTabs').addEventListener('keydown', e => {
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); tabs[j].focus(); setTab(tabs[j].dataset.tab);
  });
  // state changes (and controls built later: look cards, the export panel) keep their attributes up to date
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'attributes') { if (m.target.matches) a11ySync(m.target); continue; }
      for (const n of m.addedNodes) if (n.nodeType === 1) { a11yAll(n); if (n.matches(A11Y_TOGGLES)) a11ySync(n); a11yNameControls(n); }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  const mb = $('#moreBtn'), pop = $('#morePop');
  mb.setAttribute('aria-expanded', 'false'); mb.setAttribute('aria-controls', 'morePop');
  new MutationObserver(() => mb.setAttribute('aria-expanded', String(!pop.hidden))).observe(pop, { attributes: true, attributeFilter: ['hidden'] });
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { pop.hidden = true; mb.focus(); } });
  for (const [id, label] of [['srcCanvas', 'The original picture'], ['outCanvas', 'The text art']]) { const c = $('#' + id); c.setAttribute('role', 'img'); c.setAttribute('aria-label', label); }
  const pb = $('#progBarWrap'); pb.setAttribute('role', 'progressbar'); pb.setAttribute('aria-valuemin', '0'); pb.setAttribute('aria-valuemax', '100'); pb.setAttribute('aria-labelledby', 'progTitle');
  $('#progress').setAttribute('role', 'dialog'); $('#progress').setAttribute('aria-modal', 'true'); $('#progress').setAttribute('aria-labelledby', 'progTitle');
}
/* WCAG contrast ratio of two colours (#rrggbb) */
function contrastRatio(a, b) {
  const L = h => { const [r, g, bb] = hexToRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
  const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
