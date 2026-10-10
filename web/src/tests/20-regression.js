/* =====================================================================
   Regression test (open test.html#equiv): hashes of the conversion engine, the text formats and the encoders
   on synthetic pixels. No canvas resampling and no fonts are involved, so the hashes are the same on every
   machine and browser. Each group must match EQUIV_BASELINE; after an intended change of results, paste the
   new baseline the page prints into EQUIV_BASELINE.
   ===================================================================== */
const EQUIV_BASELINE = {"braille/mono":"80ed5cd4", "braille/color":"90b47959", "braille/gray":"aa9af11d", "braille/gradient":"26cc3fa7", "braille/discord":"b9fb4d13", "braille/ansi16":"59261307", "braille/ansi256":"2a8a28cf", "ascii/mono":"d8131a4", "ascii/color":"c375ad97", "ascii/gray":"9cd65da6", "ascii/gradient":"307094ea", "ascii/discord":"10624337", "ascii/ansi16":"a25c65", "ascii/ansi256":"edf5d1bc", "edge/mono":"5cff6fc9", "edge/color":"30aaf650", "edge/gray":"81fb68f7", "edge/gradient":"675226b2", "edge/discord":"7ef20048", "edge/ansi16":"c77be3d9", "edge/ansi256":"884760d6", "half/mono":"2c295a3a", "half/color":"fce77fa", "half/gray":"2c00f749", "half/gradient":"963107ed", "half/discord":"6d408fc3", "half/ansi16":"354fc0ea", "half/ansi256":"d106164d", "quad/mono":"15451cf7", "quad/color":"27c636c5", "quad/gray":"2066e61e", "quad/gradient":"33be9f30", "quad/discord":"1d233686", "quad/ansi16":"666999b8", "quad/ansi256":"68f63470", "halftone/mono":"5591b69b", "halftone/color":"8102d88d", "halftone/gray":"e8de1014", "halftone/gradient":"c03a83d4", "halftone/discord":"c5a4d9fd", "halftone/ansi16":"ad76ceec", "halftone/ansi256":"983285a9", "word/mono":"52f4e5e0", "word/color":"165c8a2c", "word/gray":"8707ae73", "word/gradient":"f9723950", "word/discord":"82365a1f", "word/ansi16":"91ad0ea6", "word/ansi256":"90b71004", "retro/gameboy":"7c24f44e", "retro/cga":"17ebae84", "retro/c64":"ae9fdfa6", "retro/pico8":"de19d3b5", "retro/amber":"2c522933", "retro/green":"4b00455", "glyph/pixel":"224cc5a0", "ascii/pixel-sorted":"13012a49", "custom-palette":"f151afaf", "share":"d017e1ab", "gif":"51bbf52e", "crc":"8e0979c"};
/* A test scene (sky gradient, a sun, a dark box, a thin diagonal, noise, a half transparent band) at any size. */
function synthPixels(W, H, seed) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H, o = (y * W + x) * 4;
    let r = 30 + 200 * v, g = 60 + 120 * u, b = 200 - 150 * v;
    const du = u - 0.68, dv = v - 0.35;
    if (du * du + dv * dv < 0.03) { r = 255; g = 220; b = 120; }
    if (u > 0.12 && u < 0.42 && v > 0.55 && v < 0.85) { r = 25; g = 20; b = 40; }
    if (Math.abs(u - (1 - v)) < 0.006) { r = g = b = 250; }
    const n = (hashNoise(x * 7 + seed, y * 13 + seed) - 0.5) * 36;
    d[o] = r + n; d[o + 1] = g + n; d[o + 2] = b + n; d[o + 3] = u < 0.06 ? 120 : 255;
  }
  return d;
}
function equivCases() {
  const modes = ['braille', 'ascii', 'edge', 'half', 'quad', 'halftone', 'word'];   // 'glyph' and sortRamp measure fonts
  const colours = [{ colorMode: 'mono' }, { colorMode: 'color' }, { colorMode: 'gray' }, { colorMode: 'gradient' }, { colorMode: 'app', appPalette: 'discord' }, { colorMode: 'app', appPalette: 'ansi16' }, { colorMode: 'app', appPalette: 'ansi256' }];
  const variants = [{}, { dither: 'atkinson' }, { dither: 'bayer8' }, { dither: 'noise' }, { dither: 'none' }, { outline: 0 }, { outline: 0.8, outlineWidth: 2 }, { outline: 1, outlineWidth: 3 },
    { bgFade: 0.6 }, { localContrast: 0.5, sharpen: 1 }, { edge: 0.5, autoLevels: true, invert: true }, { gamma: 1.6, saturation: 1.4, contrast: 0.3, brightness: -0.1 },
    { bgMode: 'cell' }, { charset: 'detailed', outlineDir: false }, { fill: 0 }, { threshold: 0.3, brailleBlank: 'space' }, { wordFillAll: true, fg: '#101010', bg: '#f0f0f0' }, { rotate: 90, cropL: 10, charAspect: 1.6 }];
  const out = [];
  for (const mode of modes) for (const c of colours) for (let vi = 0; vi < variants.length; vi++) for (const cols of [23, 64])
    out.push({ group: mode + '/' + (c.appPalette || c.colorMode), name: `${mode}/${c.appPalette || c.colorMode}/v${vi}/${cols}`, St: Object.assign({}, DEFAULTS, { mode, cols }, c, variants[vi]) });
  // the pixel font makes the Shape style and sorted ramps independent of installed fonts
  for (const v of [{}, { glyphSet: 'alnum' }, { glyphSet: 'lines', outline: 0.8 }, { colorMode: 'color' }]) for (const cols of [23, 64])
    out.push({ group: 'glyph/pixel', name: `glyph/pixel/${JSON.stringify(v)}/${cols}`, St: Object.assign({}, DEFAULTS, { mode: 'glyph', fontFamily: 'pixel', cols }, v) });
  for (const cs of ['detailed', 'standard', 'blocks']) for (const cols of [23, 64])
    out.push({ group: 'ascii/pixel-sorted', name: `ascii/pixel-sorted/${cs}/${cols}`, St: Object.assign({}, DEFAULTS, { mode: 'ascii', fontFamily: 'pixel', sortRamp: true, charset: cs, cols }) });
  // your own palette (nearest colour, and shaded by brightness)
  for (const tone of [false, true]) for (const mode of ['braille', 'half', 'ascii']) for (const cols of [23, 64])
    out.push({ group: 'custom-palette', name: `custom/${tone}/${mode}/${cols}`, St: Object.assign({}, DEFAULTS, { mode, cols, colorMode: 'app', appPalette: 'custom', customPaletteTone: tone, customPalette: '#000 #1d2b53 #7e2553 #ff004d #ffa300 #fff1e8' }) });
  // retro palettes: one group each, over the modes that show colour best
  for (const pal of Object.keys(RETRO_PALETTES)) for (const mode of ['braille', 'ascii', 'half', 'quad', 'halftone']) for (const vi of [0, 4, 12]) for (const cols of [23, 64])
    out.push({ group: 'retro/' + pal, name: `retro/${pal}/${mode}/v${vi}/${cols}`, St: Object.assign({}, DEFAULTS, { mode, cols, colorMode: 'app', appPalette: pal }, variants[vi]) });
  return out;
}
function equivInputs(St, sw, sh) {
  const { W, H, sx } = gridFor(sw, sh, St), seed = St.cols;
  if (!(outlineAmount(St) > 0)) return { sample: synthPixels(W, H, seed), hi: null };
  const f = hiFactor(W, H, sx);
  return { sample: synthPixels(W, H, seed), hi: synthPixels(W * f, H * f, seed + 1) };
}
async function equivTest() {
  const out = $('#selftest'); out.hidden = false;
  const log = [], say = l => { log.push(l); out.textContent = log.join('\n'); };
  const fnvBytes = (h, a) => { if (!a) return h; const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619); return h; };
  const fnvStr = (h, s) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h; };
  const groups = {}, add = (g, h) => { groups[g] = Math.imul((groups[g] || 2166136261) ^ (h >>> 0), 16777619); };
  const saved = Object.assign({}, S), sw = 800, sh = 500, t0 = performance.now();
  const cases = equivCases(), viaWorker = [];
  for (let k = 0; k < cases.length; k++) {
    const { group, St } = cases[k];
    Object.assign(S, St);   // the ANSI writer reads the palette from the settings
    const pre = equivInputs(St, sw, sh), r = convertCore(null, sw, sh, St, null, pre);
    let h = 2166136261;
    for (const a of [r.cp, r.fg, r.bgc, r.bits, r.val]) h = fnvBytes(h, a);
    h = fnvStr(h, `${r.cols}x${r.rows}${r.uniform}`);
    h = fnvStr(h, resultText(r)); h = fnvStr(h, resultANSI(r)); h = fnvStr(h, resultHTMLInner(r)); h = fnvStr(h, resultSVG(r, St));
    add(group, h);
    if (k % 7 === 0) viaWorker.push([k, h, pre]);
    if (k % 50 === 0) { out.textContent = log.concat(`converting ${k} / ${cases.length}…`).join('\n'); await nextTick(); }
  }
  Object.assign(S, saved);
  // shares (platform text, splitting, Discord colours)
  { const St = Object.assign({}, DEFAULTS, { mode: 'braille', colorMode: 'color', cols: 90 }), r = convertCore(null, sw, sh, St, null, equivInputs(St, sw, sh));
    for (const pk of Object.keys(PLATFORMS)) for (const split of [false, true]) { S.shareSplit = split; add('share', fnvStr(fnvStr(2166136261, shareParts(r, PLATFORMS[pk], true).join('\u0001')), platformText(r, PLATFORMS[pk], false))); }
    S.shareSplit = saved.shareSplit; }
  // encoders
  for (const [w, h, colors, transparent] of [[97, 61, 256, false], [64, 48, 16, true], [300, 7, 2, false], [1, 1, 4, false]]) {
    const px = synthPixels(w, h, w); if (transparent) for (let i = 3; i < px.length; i += 4 * 5) px[i] = 0;
    add('gif', fnvBytes(2166136261, gifFrameBytes(px, colors, transparent, 7, transparent ? 2 : 1, w, h)));
  }
  add('crc', crc32(synthPixels(50, 50, 3)));
  // the same conversions on a worker must give the same results
  let workerNote = 'workers unavailable, skipped';
  if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && !window.__noWorkers && !Pool.size()) { say('FAIL the background workers could not start (see the console)'); workerNote = 'workers did not start: results differ from a working page'; }
  if (Pool.size()) {
    let bad = 0;
    await Promise.all(viaWorker.map(async ([k, h, pre]) => {
      const { St } = cases[k], r = await Pool.run('convertPre', { pre, sw, sh, St });
      let x = 2166136261; for (const a of [r.cp, r.fg, r.bgc, r.bits, r.val]) x = fnvBytes(x, a);
      let y = 2166136261; const m = convertCore(null, sw, sh, St, null, pre); for (const a of [m.cp, m.fg, m.bgc, m.bits, m.val]) y = fnvBytes(y, a);
      if (x !== y) { bad++; say(`FAIL worker differs: ${cases[k].name}`); }
    }));
    workerNote = bad ? `${bad} of ${viaWorker.length} differ` : `${viaWorker.length} cases identical`;
  }
  const now = Object.fromEntries(Object.entries(groups).map(([g, h]) => [g, (h >>> 0).toString(16)]));
  const keys = Object.keys(now), baseKeys = Object.keys(EQUIV_BASELINE);
  let fails = 0;
  for (const g of keys) {
    if (!(g in EQUIV_BASELINE)) { say(`NEW  ${g} ${now[g]}`); fails++; }
    else if (EQUIV_BASELINE[g] !== now[g]) { say(`FAIL ${g}: expected ${EQUIV_BASELINE[g]}, got ${now[g]}`); fails++; }
  }
  for (const g of baseKeys) if (!(g in now)) { say(`FAIL ${g}: no longer tested`); fails++; }
  say(`${fails ? 'FAIL' : 'PASS'} ${keys.length - fails} of ${keys.length} groups match (${cases.length} conversions, ${(performance.now() - t0).toFixed(0)} ms); worker check: ${workerNote}`);
  if (fails) say('\nNew baseline (paste into EQUIV_BASELINE if the change was intended):\n' + JSON.stringify(now));
  document.title = fails || /differ/.test(workerNote) ? 'EQUIV FAIL' : 'EQUIV PASS';
}
