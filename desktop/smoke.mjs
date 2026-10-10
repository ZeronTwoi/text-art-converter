// Checks the desktop shell by running it for real and driving it over the DevTools
// protocol (the same way web/test.mjs drives the browser):
//
//   node smoke.mjs                 start → a file from the command line opens and converts →
//                                  stable app:// origin → camera (a fake test camera) → share
//                                  buttons hidden → no offline cache → settings and the open
//                                  session survive a restart → a second start hands its file
//                                  to the window that is already open, then exits
//   node smoke.mjs selftest        the page's own suites, run inside the shell (they need a
//        uitest, videotest, equiv  source checkout: test.html is not shipped in packages)
//   node smoke.mjs --app <exe>     check a packaged build instead of the dev shell
//
// Exit code 1 when anything fails.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const appIx = args.indexOf('--app');
const packagedExe = appIx > -1 ? args.splice(appIx, 2)[1] : null;
const exe = packagedExe || createRequire(import.meta.url)('electron');
const suites = args.filter(a => !a.startsWith('-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* a small real picture to open: a 64x48 BMP gradient, written without any image library */
function bmpBytes(w, h, tint) {
  const row = (w * 3 + 3) & ~3, data = Buffer.alloc(54 + row * h);
  data.write('BM'); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(w, 18); data.writeInt32LE(h, 22);
  data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = 54 + y * row + x * 3;
    data[o] = tint; data[o + 1] = Math.round(255 * y / h); data[o + 2] = Math.round(255 * x / w);
  }
  return data;
}

function launch(userDir, port, files = []) {
  const a = [...(packagedExe ? [] : ['.']),
    ...(port ? [`--remote-debugging-port=${port}`] : []),
    `--smoke-user-data=${userDir}`,
    '--use-fake-device-for-media-streams',
    ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
    ...files];
  return spawn(exe, a, { cwd: here, stdio: 'ignore' });
}

/* ---- the DevTools protocol, trimmed to what is needed ---- */
async function attach(port) {
  let info;
  for (let i = 0; i < 300 && !info; i++) { try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) { await sleep(100); } }
  if (!info) throw new Error('the shell did not start');
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('could not attach to the shell')); });
  const pending = new Map(); let id = 0; const errors = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  let page;
  for (let i = 0; i < 300 && !page; i++) {
    const { targetInfos } = await send('Target.getTargets');
    page = targetInfos.find(t => t.type === 'page' && t.url.startsWith('app://'));
    if (!page) await sleep(100);
  }
  if (!page) throw new Error('no app:// page appeared');
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
  const until = async (expr, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(250); } return false; };
  const close = async proc => {   // close the window so storage is flushed to disk; only then give up and kill
    const gone = new Promise(r => proc.on('exit', r));
    try { await ev('window.close()'); } catch (e) {}
    await Promise.race([gone, sleep(10000).then(() => proc.kill())]);
    try { ws.close(); } catch (e) {}
    await sleep(200);
  };
  return { send, ev, until, errors, sessionId, close };
}

/* ---- the quick checks: the seven things the shell is for ---- */
async function quick() {
  const lines = []; let ok = true;
  const check = (name, c) => { lines.push(`${c === true ? 'PASS' : 'FAIL'} ${name}${c === true ? '' : ' — got: ' + JSON.stringify(c)}`); if (c !== true) ok = false; };
  const dir = mkdtempSync(join(tmpdir(), 'textart-desktop-'));
  const f1 = join(dir, 'smoke.bmp'), f2 = join(dir, 'smoke2.bmp');
  writeFileSync(f1, bmpBytes(64, 48, 40)); writeFileSync(f2, bmpBytes(64, 48, 220));
  const userDir = join(dir, 'data');
  const port = 9300 + Math.floor(Math.random() * 600), t0 = Date.now();

  let proc = launch(userDir, port, [f1]);        // first start, with a file on the command line
  let c = await attach(port);
  try {
    check('the shell starts and the page loads', await c.until("typeof App === 'object' && document.readyState === 'complete'"));
    check('a stable app:// origin, so storage persists', await c.ev('location.origin') === 'app://app');
    check('the file from the command line opened', await c.until("!!App.src && App.src.name === 'smoke.bmp'"));
    check('…and converted to text art', await c.until('!!App.res'));
    check('share buttons hidden (no share sheet on a desktop)', await c.ev('typeof navigator.share') === 'undefined');
    check('no manifest, no offline cache (the shell is the offline copy)',
      await c.ev("!document.querySelector('link[rel=manifest]') && !(navigator.serviceWorker && navigator.serviceWorker.controller)"));
    check('video tools present', await c.ev("typeof VideoEncoder === 'function' && typeof OffscreenCanvas === 'function' && typeof MediaRecorder === 'function'"));
    check('video encoding supported', await c.ev("VideoEncoder.isConfigSupported({ codec: 'vp8', width: 320, height: 240 }).then(r => !!r.supported).catch(e => 'no: ' + e.message)"));
    check('the camera starts (a fake test camera)', await c.ev(
      "navigator.mediaDevices.getUserMedia({ video: true }).then(s => { const live = s.getVideoTracks()[0].readyState === 'live'; s.getTracks().forEach(t => t.stop()); return live; }).catch(e => 'no: ' + e.message)"));
    await c.ev("applySettings({ mode: 'ascii', cols: 77 })");
    check('the session saves', await c.ev('sessionSave().then(() => true)'));
    await c.ev("localStorage.setItem('desktopSmoke', 'kept')");
    check('no page errors', c.errors.length === 0 || c.errors);
  } finally { await c.close(proc); }

  proc = launch(userDir, port + 1);              // second start, same data folder
  c = await attach(port + 1);
  try {
    check('starts again', await c.until("typeof App === 'object' && document.readyState === 'complete'"));
    check('settings survived the restart', await c.ev("localStorage.getItem('desktopSmoke')") === 'kept');
    check('the start screen offers to continue', await c.until("!!document.getElementById('resumeBox') && !document.getElementById('resumeBox').hidden"));
    await c.ev("document.getElementById('resumeGo').click()");
    check('Continue restores the picture and the settings', await c.until("!!App.src && App.src.name === 'smoke.bmp' && S.mode === 'ascii' && S.cols === 77"));
    const second = launch(userDir, 0, [f2]);     // a second start while the window is open
    const secondGone = new Promise(r => second.on('exit', () => r(true)));
    check('a second start hands its file to the open window', await c.until("!!App.src && App.src.name === 'smoke2.bmp'", 20000));
    check('…and exits by itself', await Promise.race([secondGone, sleep(8000).then(() => 'still running')]));
    check('no page errors after the restart', c.errors.length === 0 || c.errors);
  } finally { await c.close(proc); }

  console.log(`\n=== shell: ${ok ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n` + lines.join('\n'));
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return ok;
}

/* ---- the page's own suites (test.html), run inside the shell ---- */
async function pageSuite(name) {
  const dir = mkdtempSync(join(tmpdir(), 'textart-desktop-')), port = 9300 + Math.floor(Math.random() * 600), t0 = Date.now();
  const proc = launch(join(dir, 'data'), port);
  const c = await attach(port);
  let ok = false;
  try {
    if (!(await c.ev("fetch('app://app/test.html').then(r => r.ok).catch(() => false)"))) {
      console.log(`\n=== ${name}: SKIP (test.html is not shipped in a packaged build)`);
      await c.close(proc); return true;
    }
    await c.send('Page.navigate', { url: 'app://app/test.html#' + name }, c.sessionId);
    if (name === 'videotest') {
      for (let i = 0; i < 50 && !(await c.ev("!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Start the video check'))")); i++) await sleep(200);
      await c.ev("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Start the video check')).click()");
    }
    let title = '';
    while (Date.now() - t0 < 600000 && !/PASS|FAIL/.test(title) && !(c.errors.length && Date.now() - t0 > 15000)) { await sleep(300); title = await c.ev('document.title') || ''; }
    const report = await c.ev("(document.getElementById('selftest') || {}).textContent || ''");
    ok = /PASS/.test(title) && !c.errors.length;
    console.log(`\n=== ${name}: ${ok ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    const all = report.split('\n');
    console.log((ok ? all.filter(l => /^(PASS|NOTE|SKIP)/.test(l) || l === all[all.length - 1]) : all).join('\n'));
    for (const e of c.errors) console.log('PAGE ERROR ' + e);
  } finally { await c.close(proc); }
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  return ok;
}

let failed = false;
try {
  if (!suites.length) failed = !(await quick());
  for (const s of suites) if (!(await pageSuite(s))) failed = true;
} catch (e) { console.error('ERROR', e.message); failed = true; }
console.log(failed ? '\nSHELL CHECKS FAILED' : '\nSHELL CHECKS PASSED');
process.exit(failed ? 1 : 0);
