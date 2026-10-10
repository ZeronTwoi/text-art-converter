// Builds the single offline file web/index.html (the app) and web/test.html (the app + its tests) from web/src/:
//   src/page.html      the page, with @@STYLES@@ and @@SCRIPTS@@ where the inline style and script go
//   src/styles.css     the styles
//   src/js/NN-*.js     the app script, in file-name order (one classic script: the parts share one scope)
//   src/tests/NN-*.js  the tests and diagnostics, added after the app script in test.html only
//   src/wasm/          the edge detector: edges_simd.wat (source) and edges_simd.b64 (compiled, inlined into the script)
//   src/sw.js          the offline cache for the installed app → sw.js (manifest.webmanifest and icons are kept as they are)
//
//   node build.mjs           write index.html, test.html and sw.js
//   node build.mjs --check   only check that they are up to date (exit code 1 if not)
//   node build.mjs --wasm    first recompile src/wasm/edges_simd.wat (needs: npm install wabt)
//   node build.mjs --types   type check every script file together (needs: npm install); fails on real mistakes:
//                            unknown or misspelled names, double declarations, use before declaration, assigning
//                            to a constant or function, wrong number of arguments, syntax errors
//
// After changing anything, run  node test.mjs  (or open test.html#selftest, #equiv, #uitest in a browser).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), src = join(here, 'src'), out = join(here, 'index.html'), testOut = join(here, 'test.html');
const args = process.argv.slice(2);
const read = (...p) => readFileSync(join(...p), 'utf8').replace(/\r\n/g, '\n');   // the same output from a CRLF checkout

if (args.includes('--wasm')) {
  const { createRequire } = await import('node:module');
  const wabt = await createRequire(import.meta.url)('wabt')();
  const mod = wabt.parseWat('edges_simd.wat', readFileSync(join(src, 'wasm', 'edges_simd.wat'), 'utf8'), { simd: true });
  mod.validate();
  writeFileSync(join(src, 'wasm', 'edges_simd.b64'), Buffer.from(mod.toBinary({}).buffer).toString('base64') + '\n');
  console.log('recompiled src/wasm/edges_simd.wat');
}

if (args.includes('--types')) {
  const tsc = join(here, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) { console.log('type check skipped (run  npm install  in web/ once)'); process.exit(0); }
  const r = spawnSync(process.execPath, [tsc, '-p', join(here, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8' });
  const errors = (r.stdout || '').split(/\r?\n/).filter(l => / error TS\d+:/.test(l));
  // the kinds that are real mistakes; the others are TypeScript being stricter than this plain JavaScript
  const SERIOUS = new Set([1003, 1005, 1109, 1128, 1135, 1161, 2300, 2304, 2349, 2391, 2393, 2448, 2451, 2551, 2552, 2554, 2555, 2588, 2630]);
  const serious = errors.filter(l => SERIOUS.has(+/error TS(\d+)/.exec(l)[1]));
  for (const l of serious) console.log(l);
  console.log(serious.length ? `type check: ${serious.length} mistake${serious.length > 1 ? 's' : ''} (${errors.length - serious.length} hints)` : `type check: no mistakes (${errors.length} hints)`);
  process.exit(serious.length ? 1 : 0);
}
const list = dir => readdirSync(join(src, dir)).filter(f => /^\d+-.*\.js$/.test(f)).sort();
const parts = list('js'), testParts = list('tests');
const wasm = read(src, 'wasm', 'edges_simd.b64').trim();
// interface languages: src/i18n/<lang>.json (English → that language), compressed into the page. The English
// sentences are stored once (LANG_KEYS); each language is the list of its translations in the same order.
const langs = existsSync(join(src, 'i18n')) ? Object.fromEntries(readdirSync(join(src, 'i18n')).filter(f => f.endsWith('.json')).map(f => [f.slice(0, -5), JSON.parse(read(src, 'i18n', f))])) : {};
const langKeys = [...new Set(Object.values(langs).flatMap(Object.keys))].sort();
const packed = v => deflateRawSync(Buffer.from(JSON.stringify(v)), { level: 9 }).toString('base64');
const langData = l => l === 'KEYS' ? packed(langKeys) : langs[l] ? packed(langKeys.map(k => langs[l][k] ?? null)) : '';
let appScript = parts.map(f => read(src, 'js', f)).join('').replace('@@EDGES_WASM_BASE64@@', wasm).replace(/'@@LANG_(\w+)@@'/g, (_, l) => `'${langData(l)}'`);
// a build stamp (shown by "About this app" in the find tool); from the sources only, so the build stays reproducible
appScript = appScript.replace('@@BUILD@@', createHash('sha256').update(appScript).digest('hex').slice(0, 8));
const testScript = appScript + testParts.map(f => read(src, 'tests', f)).join('');
const page = read(src, 'page.html'), styles = read(src, 'styles.css');
const pageWith = script => page.replace('@@STYLES@@\n', () => styles).replace('@@SCRIPTS@@\n', () => script);
const html = pageWith(appScript), testHtml = pageWith(testScript).replace('<title>Image to Text Converter</title>', '<title>Image to Text Converter · tests</title>');

// the offline cache of the installed app: its version follows the page, so a new build replaces the cached copy
const swOut = join(here, 'sw.js'), sw = read(src, 'sw.js').replace('@@VERSION@@', createHash('sha256').update(html).digest('hex').slice(0, 12));
if (args.includes('--check')) {
  const same = [[out, html], [testOut, testHtml], [swOut, sw]].every(([f, c]) => existsSync(f) && read(f) === c);
  console.log(same ? 'index.html, test.html and sw.js are up to date' : 'index.html, test.html or sw.js differs from src/ (run: node build.mjs)');
  process.exit(same ? 0 : 1);
}
writeFileSync(out, html);
writeFileSync(testOut, testHtml);
writeFileSync(swOut, sw);
console.log(`index.html written (${parts.length} script parts, ${(html.length / 1024).toFixed(0)} KB); test.html (+${testParts.length} test parts, ${(testHtml.length / 1024).toFixed(0)} KB)`);
