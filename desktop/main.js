// The desktop shell: the offline page web/index.html in its own window (Windows and Linux).
// It serves the page from app:// so the origin is stable and localStorage / IndexedDB
// (settings, projects, sessions) persist, hands over files from the command line,
// a double-click or a second start, allows the camera, opens outside links in the
// system browser — and nothing more: the page itself is unchanged and self-contained.
'use strict';
const { app, BrowserWindow, Menu, protocol, session, shell, ipcMain, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const APP_ID = 'io.github.lightervoids.text-art-studio';
const webDir = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web');

// app:// behaves like https:// (a "standard", secure scheme), so storage works and persists
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// There is no share sheet to hand things to here. With the feature off, navigator.share is
// undefined and the page's share buttons hide themselves (copy and save remain).
app.commandLine.appendSwitch('disable-features', 'WebShare');

// the portable .exe keeps its data next to itself; the installed app in the normal per-user place
if (process.env.PORTABLE_EXECUTABLE_DIR) app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'text-art-studio-data'));
// smoke.mjs gives every check run its own clean data folder
const smokeData = process.argv.find(a => a.startsWith('--smoke-user-data='));
if (smokeData) app.setPath('userData', smokeData.slice(smokeData.indexOf('=') + 1));

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
    },
  });
  Menu.setApplicationMenu(null);   // the page is the whole interface
  if (s.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => { try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch (e) {} });
  win.on('closed', () => { win = null; });

  // links to the outside open in the system browser; the window never leaves the page
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://app/')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // F12 or Ctrl+Shift+I: the developer tools (there is no menu to reach them)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools(); e.preventDefault();
    }
  });

  win.loadURL('app://app/index.html');
}
