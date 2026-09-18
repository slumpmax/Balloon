'use strict';
const { createSystem } = require('../public/nes-runtime.js');
const ROM = require('../public/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const s = createSystem({ rom: ROM, headless: true });
/* find frames where gameplay (field view) is active and detect rapid flicker */
let prev = null;
let prevSig = '';
for (let f = 0; f < 3000; f++) {
  s.frame();
  const px = s.video.pixels;
  /* signature of the field region (rows 100-200, center) where the playing field is */
  let h = 2166136261 >>> 0;
  for (let y = 100; y < 200; y += 3) {
    for (let x = 80; x < 200; x += 3) h = Math.imul(h ^ px[y * 256 + x], 16777619) >>> 0;
  }
  const sg = h.toString(16);
  const pc = s.cpu.PC;
  const isField = (pc >= 0x8000) && (s.ppu.mask & 0x18);
  if (prevSig && prevSig === sg && prev === sg) { /* stable 2 frames same - fine */ }
  else {
    /* changed - check if it reverts next frame (flicker) */
  }
  prevSig = sg;
  if (f > 400 && (f % 250 === 0)) console.log('f' + f, 'sig=' + sg, 'pc=$' + pc.toString(16), 'scroll=' + s.ppu.scrollX + ',' + s.ppu.scrollY);
}
console.log('done');