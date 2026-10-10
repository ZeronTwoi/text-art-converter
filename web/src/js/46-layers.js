/* =====================================================================
   Layer: a picture on top of yours (logo, watermark, frame, sticker), mixed in before the conversion, so it becomes
   characters too. Placed on the cropped and turned picture; stays when you open another picture (so batches get it
   too); saved in projects.
   ===================================================================== */
const Layer = { bmp: null, png: null, name: '', id: 0 };
const LAYER_MAX = 1024;
function layerActive(S) { return !!(Layer.bmp && S.layerOn && S.layerOpacity > 0); }
function layerSig(S) { return layerActive(S) ? `|L${Layer.id},${S.layerX},${S.layerY},${S.layerSize},${S.layerOpacity},${S.layerBlend}` : ''; }
/* draws the layer over a picture that drawTransformed drew (an sw × sh source on a W × H canvas) */
function drawLayer(ctx, sw, sh, W, H, S) {
  if (!layerActive(S)) return;
  const [, , iw, ih] = cropRect(sw, sh, S), rot = normRot(S.rotate), A = rot === 90 || rot === 270 ? ih / iw : iw / ih;   // the picture's width : height
  const b = Layer.bmp, w = W * S.layerSize, h = H * S.layerSize * A * b.height / b.width;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = S.layerOpacity; ctx.globalCompositeOperation = S.layerBlend;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(b, S.layerX * W - w / 2, S.layerY * H - h / 2, w, h);
  ctx.restore();
}
/* keepSetting: opening a project (its own "show" setting stays) */
async function setLayerFile(file, keepSetting) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const w0 = img.naturalWidth || 300, h0 = img.naturalHeight || 150, k = Math.min(1, LAYER_MAX / Math.max(w0, h0)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    Layer.png = new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
    Object.assign(Layer, { bmp: c, name: file.name || 'layer.png', id: Layer.id + 1 });
    if (!keepSetting) applySettings({ layerOn: true });
    layerChanged();
    return true;
  } catch (e) { toast('Could not open that picture: ' + (e && e.message || e), 'error'); return false; }
  finally { URL.revokeObjectURL(url); }
}
function removeLayer(quiet) {
  Object.assign(Layer, { bmp: null, png: null, name: '', id: Layer.id + 1 });
  if (!quiet) applySettings({ layerOn: false });
  layerChanged();
}
function layerChanged() { App.dirty = true; App.lastIdx = -1; updateLayerUI(); scheduleSessionSave(); scheduleLooks(); }
function updateLayerUI() {
  const on = !!Layer.bmp;
  $('#layerOpts').hidden = !on; $('#layerRemove').hidden = !on;
  $('#layerPick').textContent = on ? 'Change picture…' : '＋ Choose a picture…';
  $('#layerName').textContent = on ? Layer.name : '';
}
/* projects */
function layerProjectFiles(meta, files) { if (Layer.bmp && Layer.png) { meta.layer = { file: 'layer.png', name: Layer.name }; files.push({ name: 'layer.png', data: Layer.png }); } }
async function layerFromProject(meta, get) {
  const raw = meta.layer && get(meta.layer.file);
  if (raw) await setLayerFile(new File([raw], meta.layer.name || 'layer.png', { type: 'image/png' }), true);
  else if (Layer.bmp) removeLayer(true);
}
function initLayers() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true; document.body.appendChild(inp);
  inp.addEventListener('change', () => { if (inp.files[0]) setLayerFile(inp.files[0]); inp.value = ''; });
  $('#layerPick').addEventListener('click', () => inp.click());
  $('#layerRemove').addEventListener('click', () => removeLayer());
  updateLayerUI();
}
