// Runs the checks built into test.html (the app + its tests) in a headless Chrome or Edge and prints the results:
//   #selftest  GIF round-trip, ZIP CRC, every mode and export
//   #equiv     bit-exact regression hashes of the engine, text formats and encoders (plus the worker copies)
//   #uitest    the interactive features: gallery, crop, wipe, projects, batch ZIP, editing, effects, palettes, ANSI import
//   pwa        served over http://localhost: the app installs its offline cache and still opens with the network off
//   video      #videotest with real video decoding (a second browser with software rendering: headless GPU
//              rendering shows no video frames): playback, every view, look preview, looping, seeking, export
//
//   node test.mjs                 run all of them (exit code 1 if any fails)
//   node test.mjs selftest equiv  run only these
//   CHROME=path node test.mjs     use this browser
//
// It first checks that index.html and test.html are built from src/ (node build.mjs).
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2).filter(a => !a.startsWith('-')), videoBrowser = process.argv.includes('--video-browser');
const suites = (wanted.length ? wanted : ['selftest', 'equiv', 'uitest', 'pwa', 'video']).filter(s => s !== 'video' || videoBrowser);
const runVideo = !videoBrowser && (wanted.length ? wanted.includes('video') : true);

if (!videoBrowser) try { execFileSync(process.execPath, [join(here, 'build.mjs'), '--check'], { stdio: 'inherit' }); }
catch { console.error('index.html is stale: run  node build.mjs  first'); process.exit(1); }
{ // the installable app's files: a valid manifest whose icons exist, and the offline cache lists only files that exist
  const m = JSON.parse(readFileSync(join(here, 'manifest.webmanifest'), 'utf8')), sw = readFileSync(join(here, 'sw.js'), 'utf8');
  const missing = m.icons.map(i => i.src).concat((/FILES = \[([^\]]*)\]/.exec(sw) || ['', ''])[1].match(/'\.\/[^']*'/g).map(s => s.slice(3, -1)).filter(Boolean)).filter(f => !existsSync(join(here, f)));
  if (!m.name || !m.start_url || missing.length) { console.error('app files: ' + (missing.length ? 'missing ' + missing.join(', ') : 'manifest incomplete')); process.exit(1); }
}

const candidates = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
const browser = candidates.find(p => p && existsSync(p));
if (!browser) { console.error('No Chrome or Edge found: set CHROME=<path to the browser>'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = pathToFileURL(join(here, 'test.html')).href;
const profile = mkdtempSync(join(tmpdir(), 'textart-test-'));
const port = 9300 + Math.floor(Math.random() * 600);
const proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--allow-file-access-from-files', '--window-size=1400,900', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', ...(videoBrowser ? ['--disable-gpu', '--autoplay-policy=no-user-gesture-required'] : []), 'about:blank'], { stdio: 'ignore' });

let ws, id = 0, failed = false;
const pending = new Map();
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});
try {
  let info;
  for (let i = 0; i < 150 && !info; i++) { try { info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(100); } }
  if (!info) throw new Error('the browser did not start');
  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const errors = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') errors.get(m.sessionId)?.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  for (const suite of suites) {
    const t0 = Date.now();
    if (suite === 'pwa') { const ok = await pwaCheck(); if (!ok) failed = true; continue; }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    errors.set(sessionId, []);
    await send('Runtime.enable', {}, sessionId);
    const hash = suite === 'video' ? 'videotest' : suite;
    await send('Page.navigate', { url: page + '#' + hash }, sessionId);
    const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result.value;
    if (suite === 'video') {   // the check waits for its Start button
      for (let i = 0; i < 50 && !(await ev("!![...document.querySelectorAll('button')].find(b => b.textContent.includes('Start the video check'))")); i++) await sleep(200);
      await ev("[...document.querySelectorAll('button')].find(b => b.textContent.includes('Start the video check')).click()");
    }
    let title = '';
    // stop waiting early when the page threw before it could report (e.g. a syntax error)
    while (Date.now() - t0 < 600000 && !/PASS|FAIL/.test(title) && !(errors.get(sessionId).length && Date.now() - t0 > 15000)) { await sleep(300); title = await ev('document.title') || ''; }
    const report = await ev("(document.getElementById('selftest') || {}).textContent || ''");
    const ok = /PASS/.test(title) && !errors.get(sessionId).length;
    if (!ok) failed = true;
    console.log(`\n=== ${suite}: ${ok ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    const lines = report.split('\n');
    console.log((ok ? lines.filter(l => /^(PASS|NOTE|SKIP)/.test(l) || l === lines[lines.length - 1]) : lines).join('\n'));
    for (const e of errors.get(sessionId)) console.log('PAGE ERROR ' + e);
    await send('Target.closeTarget', { targetId });
  }
  // the installed app: over http://localhost the page registers its offline cache; with the network off it still opens
  async function pwaCheck() {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    const server = createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const f = join(here, p);
      if (!f.startsWith(here) || !existsSync(f) || p.includes('..')) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': types[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); res.end(readFileSync(f));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/index.html`, t0 = Date.now(), lines = [];
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    errors.set(sessionId, []);
    const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
    const until = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(200); } return false; };
    let ok = true; const check = (name, c) => { lines.push(`${c ? 'PASS' : 'FAIL'} ${name}`); if (!c) ok = false; };
    try {
      await send('Runtime.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
      await send('Page.navigate', { url }, sessionId);
      check('page opens over http', await until("typeof App === 'object' && document.readyState === 'complete'"));
      check('manifest linked', await ev("!!document.querySelector('link[rel=manifest]')"));
      check('offline cache installed', await until("navigator.serviceWorker.ready.then(r => !!r.active)"));
      await send('Page.reload', {}, sessionId);
      check('offline cache controls the page', await until("!!navigator.serviceWorker.controller"));
      check('every app file cached', await ev("caches.keys().then(ks => caches.open(ks.find(k => k.startsWith('textart-')))).then(c => c.keys()).then(k => k.length >= 7)"));
      // continue where you left off: a picture opened, the page closed and opened again
      await ev("demoImage().then(() => { applySettings({ mode: 'ascii', cols: 77 }); return sessionSave(); })");
      await send('Page.reload', {}, sessionId);
      check('after a reload the start screen offers to continue', await until("!!document.getElementById('resumeBox') && !document.getElementById('resumeBox').hidden"));
      await ev("document.getElementById('resumeGo').click()");
      check('Continue opens the last picture with its settings', await until("!!App.src && App.src.name === 'demo-sunset.png' && S.mode === 'ascii' && S.cols === 77"));
      await ev("sessionForget(true)");
      await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, sessionId);
      await send('Page.reload', {}, sessionId);
      check('opens with the network off', await until("typeof App === 'object' && document.readyState === 'complete' && !!document.getElementById('empty')"));
      await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, sessionId);
    } catch (e) { check('pwa check ran: ' + e.message, false); }
    for (const e of errors.get(sessionId)) { lines.push('PAGE ERROR ' + e); ok = false; }
    await send('Target.closeTarget', { targetId }); server.close();
    console.log(`\n=== pwa: ${ok ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n` + lines.join('\n'));
    return ok;
  }
} catch (e) { console.error('ERROR', e.message); failed = true; }
finally {
  try { ws && ws.close(); } catch {}
  proc.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
if (runVideo) {   // real video decoding needs software rendering: a second browser
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'video', '--video-browser'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let text = ''; child.stdout.on('data', d => { text += d; });
  const code = await new Promise(r => child.on('close', r));
  process.stdout.write(text.replace(/\n(ALL CHECKS PASSED|SOME CHECKS FAILED)\s*$/, '\n'));
  if (code !== 0) failed = true;
}
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
