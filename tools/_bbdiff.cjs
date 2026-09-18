'use strict';
const { createSystem } = require('../docs/nes-runtime.js');
const ROM = require('../docs/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const s = createSystem({ rom: ROM, headless: true });
const cls = () => ['left','right','up','down','A','B','start','sel'].forEach(b => s.setButton(0, b, false));
const run = n => { for (let i = 0; i < n; i++) s.frame(); };
const btn = (b, h) => { cls(); s.setButton(0, b, true); run(h || 4); s.setButton(0, b, false); };
run(60); btn('start'); run(30);
/* capture baseline frame */
s.frame();
const px0 = new Uint8Array(s.video.pixels);
const SIG = {};
for (let y = 0; y < 240; y++) {
  let h = 2166136261 >>> 0;
  for (let x = 0; x < 256; x++) h = Math.imul(h ^ px0[y * 256 + x], 16777619) >>> 0;
  SIG[y] = h;
}
/* now run 400 frames, diff against baseline per-scanline */
for (let f = 0; f < 400; f++) {
  s.frame();
  const px = s.video.pixels;
  for (let y = 0; y < 240; y++) {
    let h = 2166136261 >>> 0;
    for (let x = 0; x < 256; x++) h = Math.imul(h ^ px[y * 256 + x], 16777619) >>> 0;
    if (h !== SIG[y]) {
      const first = (() => { for (let x = 0; x < 256; x++) if (px[y * 256 + x] !== px0[y * 256 + x]) return x; return -1; })();
      console.log('DIFF frame=' + f + ' y=' + y + ' firstx=' + first + ' pc=' + s.cpu.PC.toString(16));
    }
  }
}
console.log('done');