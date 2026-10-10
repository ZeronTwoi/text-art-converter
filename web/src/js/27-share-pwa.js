/* =====================================================================
   Sending to other apps (the system share sheet on phones and Windows) and the installable app (only when the
   page is served over https or localhost; opened as a file it stays a plain offline page)
   ===================================================================== */
function canShareFiles(type) {
  try { return typeof navigator.share === 'function' && !!navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(4)], 'x.' + type.split('/')[1], { type })] }); }
  catch (e) { return false; }
}
const canShareText = () => typeof navigator.share === 'function';
async function shareFile(blob, name) {
  try { await navigator.share({ files: [new File([blob], name, { type: blob.type })], title: name }); return true; }
  catch (e) { if (e && e.name === 'AbortError') return false; toast('Sharing did not work here (' + (e && e.message || e) + '). Save the file instead', 'error'); return false; }
}
async function actSharePicture() {
  if (!requireRes()) return;
  try { await shareFile(await renderStill(IMG_FORMATS[0]), baseName() + '.png'); } catch (e) { toast(e.message, 'error'); }
}
/* a GIF takes longer than a click allows to wait before sharing: make it, then share with a second tap */
async function actShareGIF() {
  if (!confirmLarge(countFrames())) return;
  let blob = null;
  await runExport('Making the GIF', async progress => { blob = new Blob([await gifBytes(progress)], { type: 'image/gif' }); });
  if (!blob) return;
  const d = $('#shareDialog');
  $('#shareDialogText').textContent = `Your GIF is ready (${fmtBytes(blob.size)}).`;
  $('#shareDialogGo').onclick = async () => { d.close(); await shareFile(blob, baseName() + '.gif'); };
  d.showModal();
}
async function actShareText() {
  if (!requireRes()) return;
  updateShareUI(true);
  const text = (App.shareParts && App.shareParts[0]) || resultText(App.res);
  try { await navigator.share({ text }); } catch (e) { if (!(e && e.name === 'AbortError')) toast('Sharing did not work here. Use Copy instead', 'error'); }
}
/* ---- installable app ---- */
const servedOnWeb = () => location.protocol === 'https:' || (location.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname));
function initPWA() {
  $('#shareDialogCancel').addEventListener('click', () => $('#shareDialog').close());
  // the desktop app: files from the command line or a double-click arrive over its small bridge (desktop/preload.js)
  if (window.desktopHost) {
    const arrived = files => { const f = files && files[0]; if (f) openFile(new File([f.data], f.name, { type: f.type || '' })); };
    window.desktopHost.onOpenedFiles(arrived);
    window.desktopHost.takeOpenedFiles().then(arrived);
    // a newer release exists (checked only when the app starts, only if the user said yes): a small ⚠ in the top bar
    if (window.desktopHost.onUpdateAvailable) window.desktopHost.onUpdateAvailable(() => {
      const b = $('#updateBadge'); b.hidden = false;
      b.addEventListener('click', () => { b.hidden = true; window.desktopHost.openUpdate(); });
    });
  }
  if (!servedOnWeb()) return;   // a file on disk: nothing to install, nothing to cache
  const link = document.createElement('link'); link.rel = 'manifest'; link.href = 'manifest.webmanifest'; document.head.appendChild(link);
  const apple = document.createElement('link'); apple.rel = 'apple-touch-icon'; apple.href = 'icon-192.png'; document.head.appendChild(apple);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('offline cache unavailable:', e && e.message));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); App.installPrompt = e; $('#btnInstall').hidden = false; });
  window.addEventListener('appinstalled', () => { App.installPrompt = null; $('#btnInstall').hidden = true; toast('Installed. Text Art Studio now opens like an app, also offline'); });
  $('#btnInstall').addEventListener('click', async () => { const p = App.installPrompt; if (!p) return; p.prompt(); try { await p.userChoice; } catch (e) {} App.installPrompt = null; $('#btnInstall').hidden = true; });
  // files opened with the installed app ("Open with…")
  if ('launchQueue' in window) window.launchQueue.setConsumer(async params => { if (params.files && params.files.length) openFile(await params.files[0].getFile()); });
}
