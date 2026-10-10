/* =====================================================================
   First-run tour: a few highlighted steps for new users. Skip ends it for good; Help → Take the tour.
   ===================================================================== */
const TOUR = [
  { el: () => $('.topacts label[for="fileInput"]'), title: 'Open a picture', text: 'Open a picture, GIF or video, or drop it anywhere on the page. No file at hand? The start screen has a demo.' },
  { el: () => $('#looks'), tab: 'look', title: 'Pick a look', text: 'Each card shows your picture in that style. Point at one to preview it, click to use it.' },
  { el: () => $('#leftTabs'), title: 'Fine-tune', text: 'Adjust the size and light, the colours, and crop or turn the picture. Everything can be undone (Ctrl+Z).' },
  { el: () => $('#goalSeg'), title: 'Share or save', text: 'Send it to a chat app as text, or save a picture, GIF or video.' },
  { el: () => $('#btnFind'), title: 'Find anything', text: 'Looking for a tool? Press Ctrl+K (or this button) and type what you want to do.' },
];
const Tour = { i: -1 };
const TOUR_KEY = 'textArtStudio.tourDone';
function startTour() {
  if (isNarrow()) setSheet(null);
  for (const d of $$('dialog[open]')) d.close();
  Tour.i = 0; $('#tour').hidden = false; showTourStep();
}
function endTour() {
  Tour.i = -1; $('#tour').hidden = true;
  try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
}
function showTourStep() {
  const st = TOUR[Tour.i]; if (!st) return endTour();
  if (st.tab) setTab(st.tab);
  const el = st.el(), spot = $('#tourSpot'), card = $('#tourCard');
  $('#tourTitle').textContent = st.title; $('#tourText').textContent = st.text;
  $('#tourCount').textContent = `${Tour.i + 1} / ${TOUR.length}`;
  $('#tourBack').disabled = Tour.i === 0; $('#tourNext').textContent = Tour.i === TOUR.length - 1 ? 'Done' : 'Next';
  const r = el && el.getClientRects().length ? el.getBoundingClientRect() : null;
  if (r && r.width) {
    Object.assign(spot.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: Math.min(r.height, innerHeight * 0.6) + 12 + 'px' }); spot.hidden = false;
    // the card beside the highlight, where there is room
    const cw = Math.min(340, innerWidth - 24), right = r.right + 16 + cw < innerWidth, below = r.bottom + 200 < innerHeight;
    const left = right ? r.right + 16 : Math.max(12, Math.min(innerWidth - cw - 12, r.left + r.width / 2 - cw / 2));
    const top = right ? Math.max(12, Math.min(innerHeight - 220, r.top)) : below ? r.bottom + 16 : Math.max(12, r.top - 200);
    Object.assign(card.style, { left: left + 'px', top: top + 'px', width: cw + 'px' });
  } else { spot.hidden = true; Object.assign(card.style, { left: '50%', top: '30%', width: Math.min(340, innerWidth - 24) + 'px', transform: 'translateX(-50%)' }); }
  if (r && r.width) card.style.transform = '';
  $('#tourNext').focus();
}
function initTour() {
  $('#tourNext').addEventListener('click', () => { Tour.i++; showTourStep(); });
  $('#tourBack').addEventListener('click', () => { Tour.i = Math.max(0, Tour.i - 1); showTourStep(); });
  $('#tourSkip').addEventListener('click', endTour);
  $('#helpTour').addEventListener('click', () => { $('#helpDialog').close(); startTour(); });
  window.addEventListener('resize', () => { if (Tour.i >= 0) showTourStep(); });
  window.addEventListener('keydown', e => { if (Tour.i < 0) return; if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); endTour(); } }, true);
  // new users: the tour once (returning users get "What's new" instead)
  let done = false; try { done = !!localStorage.getItem(TOUR_KEY); } catch (e) {}
  if (!done && !WAS_HERE_BEFORE && (!location.hash || location.hash === '#')) setTimeout(() => { if (!App.src && !document.querySelector('dialog[open]')) startTour(); }, 700);
}
