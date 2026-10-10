/* =====================================================================
   Print / poster: the art redrawn sharp at print resolution on a paper size, with a margin and an optional
   title. Print (or "Save as PDF" in the print dialog) or download the page as a PNG.
   ===================================================================== */
const PAPERS = { a4: ['A4', 210, 297], a3: ['A3', 297, 420], a2: ['A2', 420, 594], letter: ['US Letter', 215.9, 279.4], square: ['Square poster 30 × 30 cm', 300, 300] };
function posterOptions() {
  return { paper: $('#posterPaper').value, orient: $('#posterOrient').value, dpi: +$('#posterDpi').value, margin: +$('#posterMargin').value, title: $('#posterTitle').value.trim(), white: $('#posterWhite').checked };
}
/* the page: { canvas, wmm, hmm } */
function posterPage(o) {
  const res = App.res, [, pwmm, phmm] = PAPERS[o.paper] || PAPERS.a4;
  const [p1w, p1h] = pictureSize(res.cols, res.rows, S, 1);
  let wmm = pwmm, hmm = phmm;
  const landscape = o.orient === 'landscape' || (o.orient === 'auto' && p1w > p1h);
  if (landscape !== (wmm > hmm) && wmm !== hmm) [wmm, hmm] = [hmm, wmm];
  const px = mm => Math.round(mm / 25.4 * o.dpi), W = px(wmm), H = px(hmm), m = px(o.margin), titleH = o.title ? px(Math.max(8, Math.min(wmm, hmm) * 0.06)) : 0;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), bg = S.bgMode === 'transparent' || o.white ? '#ffffff' : S.bg;
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // the largest whole-pixel cell size that fits
  const scale = Math.min((W - 2 * m) / p1w, (H - 2 * m - titleH) / p1h);
  const art = document.createElement('canvas');
  renderResult(res, S, art, scale, { bgMode: S.bgMode === 'transparent' ? 'transparent' : undefined });
  const k = Math.min(1, (W - 2 * m) / art.width, (H - 2 * m - titleH) / art.height), aw = art.width * k, ah = art.height * k;
  const ax = (W - aw) / 2, ay = m + (H - 2 * m - titleH - ah) / 2;
  g.drawImage(art, ax, ay, aw, ah);
  if (o.title) {
    const fs = Math.round(titleH * 0.55), light = lumRGB(hexToRgb(bg)) < 0.5;
    g.fillStyle = light ? '#f4f4f4' : '#1a1a1a'; g.font = `600 ${fs}px system-ui, "Segoe UI", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(o.title, W / 2, Math.min(H - m - titleH / 2, ay + ah + titleH / 2), W - 2 * m);
  }
  return { canvas: c, wmm, hmm };
}
async function posterDownload() {
  if (!requireRes()) return;
  const o = posterOptions(); showProgress('Drawing the poster', true);
  try { const p = posterPage(o), blob = await canvasToBlob(p.canvas, 'image/png'); download(blob, `${baseName()}_${o.paper}.png`); toast(`Poster saved: ${p.canvas.width} × ${p.canvas.height} px (${fmtBytes(blob.size)})`); }
  catch (e) { toast('The poster could not be made: ' + e.message, 'error'); } finally { hideProgress(); }
}
async function posterPrint() {
  if (!requireRes()) return;
  const o = posterOptions(), p = posterPage(o), url = URL.createObjectURL(await canvasToBlob(p.canvas, 'image/png'));
  const area = $('#printArea'); area.innerHTML = `<img alt="" src="${url}">`;
  let st = $('#printPage'); if (!st) { st = document.createElement('style'); st.id = 'printPage'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${p.wmm}mm ${p.hmm}mm; margin: 0 }`;
  const done = () => { area.innerHTML = ''; URL.revokeObjectURL(url); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  await new Promise(r => { const img = area.querySelector('img'); if (img.complete) r(); else { img.onload = r; img.onerror = r; } });
  window.print();
}
function openPoster() {
  if (!requireRes()) return;
  $('#posterDialog').showModal();
}
function initPoster() {
  const sel = $('#posterPaper'); for (const [k, [n]] of Object.entries(PAPERS)) { const op = document.createElement('option'); op.value = k; op.textContent = n; sel.appendChild(op); }
  $('#posterMargin').addEventListener('input', e => { $('#posterMarginOut').textContent = e.target.value + ' mm'; });
  $('#posterCancel').addEventListener('click', () => $('#posterDialog').close());
  $('#posterPng').addEventListener('click', () => { $('#posterDialog').close(); posterDownload(); });
  $('#posterPrintBtn').addEventListener('click', () => { $('#posterDialog').close(); posterPrint(); });
}
