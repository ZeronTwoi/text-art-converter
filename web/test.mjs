// Runs the page's own checks in a headless Chrome or Edge and prints the results:
//   #selftest  GIF round-trip, ZIP CRC, every mode and export
//   #equiv     bit-exact regression hashes of the engine, text formats and encoders (plus the worker copies)
//   #uitest    the interactive features: gallery, crop, wipe, projects, batch ZIP, editing, effects, palettes, ANSI import
//
//   node test.mjs                 run all three (exit code 1 if any fails)
//   node test.mjs selftest equiv  run only these
//   CHROME=path node test.mjs     use this browser
//
// It first checks that index.html is built from src/ (node build.mjs).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'));
const suites = wanted.length ? wanted : ['selftest', 'equiv', 'uitest'];

try { execFileSync(process.execPath, [join(here, 'build.mjs'), '--check'], { stdio: 'inherit' }); }
catch { console.error('index.html is stale: run  node build.mjs  first'); process.exit(1); }

const candidates = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
const browser = candidates.find(p => p && existsSync(p));
if (!browser) { console.error('No Chrome or Edge found: set CHROME=<path to the browser>'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = pathToFileURL(join(here, 'index.html')).href;
const profile = mkdtempSync(join(tmpdir(), 'textart-test-'));
const port = 9300 + Math.floor(Math.random() * 600);
const proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--allow-file-access-from-files', '--window-size=1400,900', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });

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
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    errors.set(sessionId, []);
    await send('Runtime.enable', {}, sessionId);
    await send('Page.navigate', { url: page + '#' + suite }, sessionId);
    const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result.value;
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
} catch (e) { console.error('ERROR', e.message); failed = true; }
finally {
  try { ws && ws.close(); } catch {}
  proc.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
