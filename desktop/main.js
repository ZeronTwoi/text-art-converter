// The desktop shell: the offline page web/index.html in its own window (Windows and Linux).
// It serves the page from app:// so the origin is stable and localStorage / IndexedDB
// (settings, projects, sessions) persist, hands over files from the command line,
// a double-click or a second start, allows the camera, opens outside links in the
// system browser — and nothing more: the page itself is unchanged and self-contained.
'use strict';
const { app, BrowserWindow, Menu, protocol, session, shell, ipcMain, screen, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const APP_ID = 'io.github.lightervoids.text-art-studio';
const RELEASES_API = 'https://api.github.com/repos/ZeroCopOne/ImageTo_Text_TextImage/releases/latest';
const RELEASES_PAGE = 'https://github.com/ZeroCopOne/ImageTo_Text_TextImage/releases/latest';
const webDir = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');

// app:// behaves like https:// (a "standard", secure scheme), so storage works and persists
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// There is no share sheet to hand things to here. With the feature off, navigator.share is
// undefined and the page's share buttons hide themselves (copy and save remain).
app.commandLine.appendSwitch('disable-features', 'WebShare');

// the portable .exe keeps its data next to itself; the installed app in the normal per-user place
if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'text-art-studio-data'));
// smoke.mjs gives every check run its own clean data folder; its camera check must work on
// machines without one, so the fake test camera is switched on here (a command-line switch
// from outside does not reliably reach Chromium)
const smokeData = process.argv.find(a => a.startsWith('--smoke-user-data='));
if (smokeData) {
  app.setPath('userData', smokeData.slice(smokeData.indexOf('=') + 1));
  app.commandLine.appendSwitch('use-fake-device-for-media-streams');
}

app.setAppUserModelId(APP_ID);

/* ---- files the app was started with (first start, "Open with…", or a second start) ---- */
const MIME = {
  png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  ico: 'image/x-icon', cur: 'image/x-icon', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg', ogg: 'video/ogg', '3gp': 'video/3gpp',
  txt: 'text/plain', ans: 'text/plain', asc: 'text/plain', nfo: 'text/plain', diz: 'text/plain',
};
function fileArgs(argv, cwd) {   // everything after the switches that is a real file
  return argv.slice(app.isPackaged ? 1 : 2)
    .filter(a => a && !a.startsWith('-'))
    .map(a => path.resolve(cwd || process.cwd(), a))
    .filter(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}
async function filePayload(p) {   // what the page turns back into a File (see desktopHost in 27-share-pwa.js)
  const ext = path.extname(p).slice(1).toLowerCase();
  return { name: path.basename(p), type: MIME[ext] || '', data: await fsp.readFile(p) };
}
let pendingFiles = fileArgs(process.argv);
ipcMain.handle('open-files:take', async () => { const out = await Promise.all(pendingFiles.map(filePayload)); pendingFiles = []; return out; });

/* ---- one instance; a second start passes its files to the open window ---- */
let win = null;
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', async (e, argv, cwd) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const files = fileArgs(argv, cwd);
    if (files.length) win.webContents.send('open-files', await Promise.all(files.map(filePayload)));
  });
  app.whenReady().then(start);
}
app.on('window-all-closed', () => app.quit());

/* ---- the window, where it was left ---- */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function windowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const onAScreen = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return s.x < a.x + a.width - 40 && s.x + s.width > a.x + 40 && s.y >= a.y - 20 && s.y < a.y + a.height - 40;
    });
    if (onAScreen && s.width >= 400 && s.height >= 300) return s;
  } catch (e) {}
  return { width: 1280, height: 840 };
}

/* ---- new versions: asked once, then only the release tag is fetched, only at start ---- */
const updateFile = () => path.join(app.getPath('userData'), 'update-check.json');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; } };
const newerThan = (tag, mine) => {
  const p = s => (/(\d+)\.(\d+)\.(\d+)/.exec(String(s)) || []).slice(1, 4).map(Number);
  const a = p(tag), b = p(mine);
  return a.length === 3 && b.length === 3 && (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) > 0;
};
async function updateCheck(win) {
  let cfg = readJson(updateFile(), null);
  if (!cfg) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Yes, tell me', 'No, never ask again'], defaultId: 0, cancelId: 1,
      message: 'Tell you when a new version is out?',
      detail: 'At every start the app would fetch only the latest version number from GitHub. Nothing about you or your pictures is sent. When a newer version exists, a small ⚠ appears in the top bar.',
    });
    cfg = { enabled: response === 0 };
    try { fs.writeFileSync(updateFile(), JSON.stringify(cfg)); } catch (e) {}
  }
  if (!cfg.enabled) return;
  try {
    const ctrl = new AbortController(), to = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(RELEASES_API, { signal: ctrl.signal, headers: { accept: 'application/vnd.github+json' } });
    clearTimeout(to);
    if (!r.ok) return;
    const tag = (await r.json()).tag_name || '';
    if (newerThan(tag, app.getVersion()) && !win.isDestroyed()) win.webContents.send('update-available', { tag });
  } catch (e) {}   // offline or rate-limited: quietly nothing
}
ipcMain.handle('update:open', () => shell.openExternal(RELEASES_PAGE));
ipcMain.handle('app:version', () => app.getVersion());

/* ---- page zoom on Ctrl+ / Ctrl- / Ctrl0, kept for the next start ---- */
function handleKeys(win, input) {
  const zooms = { '+': 0.5, '=': 0.5, '-': -0.5 };
  if (input.control && !input.alt && input.key in zooms) {
    const wc = win.webContents;
    wc.setZoomLevel(Math.max(-3, Math.min(3, wc.getZoomLevel() + zooms[input.key])));
    return true;
  }
  if (input.control && !input.alt && input.key === '0') { win.webContents.setZoomLevel(0); return true; }
  if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) { win.webContents.toggleDevTools(); return true; }
  return false;
}

function start() {
  // only the page itself (and, in a source checkout, its test page); the page needs no other files
  protocol.handle('app', async req => {
    const u = new URL(req.url);
    const name = u.pathname.replace(/^\/+/, '') || 'index.html';
    const file = path.join(webDir, name);
    if (u.host !== 'app' || !/^(index|test)\.html$/.test(name) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return new Response(await fsp.readFile(file), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });

  // the page asks for the camera (the webcam source); everything else stays off
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media');

  const s = windowState();
  win = new BrowserWindow({
    x: s.x, y: s.y, width: s.width, height: s.height, minWidth: 560, minHeight: 420,
    backgroundColor: '#0d0f14', show: false,
    icon: path.join(webDir, 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      backgroundThrottling: false,   // exports and playback keep full speed while the window is minimized
    },
  });
  Menu.setApplicationMenu(null);   // the page is the whole interface
  if (s.maximized) win.maximize();
  if (typeof s.zoom === 'number') win.webContents.on('did-finish-load', () => win.webContents.setZoomLevel(s.zoom));
  win.once('ready-to-show', () => { win.show(); if (!smokeData) setTimeout(() => win && !win.isDestroyed() && updateCheck(win), 1500); });
  win.on('close', () => { try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized(), zoom: win.webContents.getZoomLevel() })); } catch (e) {} });
  win.on('closed', () => { win = null; });

  // links to the outside open in the system browser; the window never leaves the page
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://app/')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // zoom keys and F12 (there is no menu to reach these)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && handleKeys(win, input)) e.preventDefault();
  });
  // if the page ever crashes, offer to reload it (the session auto-saves, so little is lost)
  win.webContents.on('render-process-gone', async (e, details) => {
    if (details.reason === 'clean-exit' || !win || win.isDestroyed()) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'error', buttons: ['Reload', 'Close'], defaultId: 0, cancelId: 1,
      message: 'The page stopped unexpectedly (' + details.reason + ').',
      detail: 'Reload to continue. The last auto-saved state of your picture is offered again on the start screen.',
    });
    if (response === 0) win.webContents.reload(); else win.close();
  });

  win.loadURL('app://app/index.html');
}
