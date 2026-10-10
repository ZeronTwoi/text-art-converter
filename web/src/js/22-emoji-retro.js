/* =====================================================================
   Retro palettes and the emoji mosaic (engine parts; also copied to the workers)
   ===================================================================== */
/* colours of old machines and monitors. tone: one hue in steps, picked by brightness (so shading survives) */
const RETRO_PALETTES = {
  gameboy: { name: 'Game Boy (4 greens)', tone: true, cols: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]] },
  cga: { name: 'CGA (black, cyan, magenta, white)', cols: [[0, 0, 0], [85, 255, 255], [255, 85, 255], [255, 255, 255]] },
  c64: { name: 'Commodore 64 (16 colours)', cols: [[0, 0, 0], [255, 255, 255], [136, 0, 0], [170, 255, 238], [204, 68, 204], [0, 204, 85], [0, 0, 170], [238, 238, 119], [221, 136, 85], [102, 68, 0], [255, 119, 119], [51, 51, 51], [119, 119, 119], [170, 255, 102], [0, 136, 255], [187, 187, 187]] },
  pico8: { name: 'PICO-8 (16 colours)', cols: [[0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81], [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232], [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54], [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170]] },
  amber: { name: 'Amber monitor', tone: true, cols: [[26, 13, 0], [92, 46, 0], [168, 92, 0], [255, 176, 0], [255, 214, 120]] },
  green: { name: 'Green monitor', tone: true, cols: [[0, 22, 6], [0, 82, 26], [16, 158, 58], [51, 255, 102], [178, 255, 196]] },
};
/* nearest colour of a retro palette */
function retroColour(P, r, g, b) {
  const c = P.cols;
  if (P.tone) { const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255; return c[Math.min(c.length - 1, Math.round(l * (c.length - 1)))]; }
  let best = c[0], bd = Infinity;
  for (const q of c) { const dr = r - q[0], dg = g - q[1], db = b - q[2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (d < bd) { bd = d; best = q; } }
  return best;
}

/* ---- emoji mosaic: each emoji is two columns wide (as in chat apps and terminals); the cell right of an emoji
   holds WIDE_CONT, which every text format leaves out ---- */
const WIDE_CONT = 0x10fffe;
const EMOJI_SETS = {
  blocks: '🟥🟧🟨🟩🟦🟪🟫⬛⬜🔴🟠🟡🟢🔵🟣🟤⚫⚪🧡💛💚💙💜🤎🖤🤍',
  mixed: '🟥🟧🟨🟩🟦🟪🟫⬛⬜🔴🟠🟡🟢🔵🟣🟤⚫⚪🧡💛💚💙💜🤎🖤🤍💗🌑🌒🌓🌔🌕🌚🌝🌲🌳🌴🌵🌿🍀🍁🍂🌸🌺🌻🌼🌷🌹🍄🌊🔥💧⛄🌈🌙⭐🍎🍏🍊🍋🍌🍉🍇🍓🍒🍑🥝🥥🍆🥑🥦🥕🌽🍞🧀🍫🍪🍩🍰🐸🐷🐻🐼🐧🐙🦊🐝🎃💎🔮🧊😀😡🥶🤢👽💀👻☁',
};
const EMOJI_FONT = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', sans-serif";
/* the average colour of every emoji of the set as it looks on the background colour (measured once per set + background) */
const emojiTables = new Map();
function emojiTable(set, bg) {
  const key = set + '|' + bg; let T = emojiTables.get(key); if (T) return T;
  const list = Array.from(EMOJI_SETS[set] || EMOJI_SETS.blocks).filter(ch => ch.codePointAt(0) > 0x2000);
  const Z = 24, c = newCanvas(Z * list.length, Z), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = bg; g.fillRect(0, 0, c.width, Z);
  g.font = `${Math.round(Z * 0.86)}px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  list.forEach((ch, i) => g.fillText(ch, i * Z + Z / 2, Z / 2 + 1));
  const d = g.getImageData(0, 0, c.width, Z).data, B = hexToRgb(bg), cps = [], rgb = [];
  list.forEach((ch, i) => {
    let r = 0, gg = 0, b = 0, changed = 0;
    for (let y = 0; y < Z; y++) for (let x = i * Z; x < (i + 1) * Z; x++) {
      const o = (y * c.width + x) * 4; r += d[o]; gg += d[o + 1]; b += d[o + 2];
      if (d[o] !== B[0] || d[o + 1] !== B[1] || d[o + 2] !== B[2]) changed++;
    }
    if (changed < Z) return;   // not drawn by any font here
    const n = Z * Z; cps.push(ch.codePointAt(0)); rgb.push(r / n, gg / n, b / n);
  });
  T = { cps, rgb };
  if (emojiTables.size > 8) emojiTables.clear();
  emojiTables.set(key, T);
  return T;
}
function nearestEmoji(T, r, g, b) {
  let bi = 0, bd = Infinity;
  for (let i = 0, o = 0; i < T.cps.length; i++, o += 3) { const dr = r - T.rgb[o], dg = g - T.rgb[o + 1], db = b - T.rgb[o + 2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db; if (d < bd) { bd = d; bi = i; } }
  return T.cps[bi];
}
