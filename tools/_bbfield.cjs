'use strict';
const { createSystem } = require('../public/nes-runtime.js');
const ROM = require('../public/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const PAL = require('../public/nes-runtime.js').PALETTE;
const s = createSystem({ rom: ROM, headless: true });
const chars = ' .:-=+*#%@';
function ascii(tag, fine) {
  s.frame();
  console.log('\n=== ' + tag + ' PC=$' + s.cpu.PC.toString(16).toUpperCase() + ' scroll=' + s.ppu.scrollX + ',' + s.ppu.scrollY + ' ctrl=$' + s.ppu.ctrl.toString(16) + ' mask=$' + s.ppu.mask.toString(16) + ' ===');
  const px = s.video.pixels;
  const dy = fine ? 2 : 4, dx = fine ? 1 : 2;
  for (let y = 0; y < 240; y += dy) {
    let line = '';
    for (let x = 0; x < 256; x += dx) {
      const i = px[y * 256 + x] * 3;
      const lum = 0.2126 * PAL[i] + 0.7152 * PAL[i + 1] + 0.0722 * PAL[i + 2];
      line += chars[Math.min(chars.length - 1, Math.floor(lum / 256 * chars.length))];
    }
    console.log(line);
  }
}
for (let f = 0; f < 900; f++) s.frame();
ascii('attract-a', true);
for (let f = 0; f < 100; f++) s.frame();
ascii('attract-b', true);