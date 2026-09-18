'use strict';
const { createSystem } = require('../public/nes-runtime.js');
const ROM = require('../public/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const s = createSystem({ rom: ROM, headless: true });
let lastPc = -1, stable = 0;
for (let i = 0; i < 120; i++) {
  s.frame();
  const pc = s.cpu.PC;
  if (pc === lastPc) stable++; else { stable = 0; lastPc = pc; }
  if (i % 30 === 0 || i === 119) console.log('frame', i, 'PC=$' + pc.toString(16).toUpperCase(), 'stable=' + stable, 'halted=' + s.isHalted());
}
s.frame();
const px = s.video.pixels;
const chars = ' .:-=+*#%@';
const PAL = require('../public/nes-runtime.js').PALETTE;
for (let y = 0; y < 240; y += 3) {
  let line = '';
  for (let x = 0; x < 256; x += 2) {
    const i = px[y * 256 + x] * 3;
    const lum = 0.2126 * PAL[i] + 0.7152 * PAL[i + 1] + 0.0722 * PAL[i + 2];
    line += chars[Math.min(chars.length - 1, Math.floor(lum / 256 * chars.length))];
  }
  console.log(line);
}