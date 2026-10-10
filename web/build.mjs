// Builds the single offline file web/index.html from web/src/:
//   src/page.html      the page, with @@STYLES@@ and @@SCRIPTS@@ where the inline style and script go
//   src/styles.css     the styles
//   src/js/NN-*.js     the script, in file-name order (one classic script: the parts share one scope)
//   src/wasm/          the edge detector: edges_simd.wat (source) and edges_simd.b64 (compiled, inlined into the script)
//
//   node build.mjs           write index.html
//   node build.mjs --check   only check that index.html is up to date (exit code 1 if not)
//   node build.mjs --wasm    first recompile src/wasm/edges_simd.wat (needs: npm install wabt)
//
// After changing anything, open index.html#selftest and index.html#equiv in a browser: both must say PASS.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), src = join(here, 'src'), out = join(here, 'index.html');
const args = process.argv.slice(2);

if (args.includes('--wasm')) {
  const { createRequire } = await import('node:module');
  const wabt = await createRequire(import.meta.url)('wabt')();
  const mod = wabt.parseWat('edges_simd.wat', readFileSync(join(src, 'wasm', 'edges_simd.wat'), 'utf8'), { simd: true });
  mod.validate();
  writeFileSync(join(src, 'wasm', 'edges_simd.b64'), Buffer.from(mod.toBinary({}).buffer).toString('base64') + '\n');
  console.log('recompiled src/wasm/edges_simd.wat');
}

const parts = readdirSync(join(src, 'js')).filter(f => /^\d+-.*\.js$/.test(f)).sort();
const wasm = readFileSync(join(src, 'wasm', 'edges_simd.b64'), 'utf8').trim();
const script = parts.map(f => readFileSync(join(src, 'js', f), 'utf8')).join('').replace('@@EDGES_WASM_BASE64@@', wasm);
const page = readFileSync(join(src, 'page.html'), 'utf8');
const html = page.replace('@@STYLES@@\n', () => readFileSync(join(src, 'styles.css'), 'utf8')).replace('@@SCRIPTS@@\n', () => script);

if (args.includes('--check')) {
  const same = existsSync(out) && readFileSync(out, 'utf8') === html;
  console.log(same ? 'index.html is up to date' : 'index.html differs from src/ (run: node build.mjs)');
  process.exit(same ? 0 : 1);
}
writeFileSync(out, html);
console.log(`index.html written (${parts.length} script parts, ${(html.length / 1024).toFixed(0)} KB)`);
