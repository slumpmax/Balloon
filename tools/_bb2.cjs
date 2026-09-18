'use strict';
const { createSystem } = require('../public/nes-runtime.js');
const ROM = require('../public/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const s = createSystem({ rom: ROM, headless: true });
function dump(label) {
  s.frame();
  const px = s.video.pixels;
  const chars = ' .:-=+*#%@';
  const PAL = require('../public/nes-runtime.js').PALETTE;
  console.log('=== ' + label + ' PC=' + s.cpu.PC.toString(16).toUpperCase() + ' ===');
  for (let y = 0; y < 240; y += 4) {
    let line = '';
    for (let x = 0; x < 256; x += 2) {
      const i = px[y * 256 + x] * 3;
      const lum = 0.2126 * PAL[i] + 0.7152 * PAL[i + 1] + 0.0722 * PAL[i + 2];
      line += chars[Math.min(chars.length - 1, Math.floor(lum / 256 * chars.length))];
    }
    console.log(line);
  }
}
function frame() { s.frame(); }
function btn(b, n) { s.setButton(0, b, true); frame(); frame(); s.setButton(0, b, false); }
for (let i = 0; i < 60; i++) frame();
dump('title');
btn('start', 0); for (let i = 0; i < 40; i++) frame();
dump('after start');
btn('A', 0); for (let i = 0; i < 40; i++) frame();
dump('after A');
btn('A', 0); for (let i = 0; i < 40; i++) frame();
dump('after A2');
btn('start', 0); for (let i = 0; i < 40; i++) frame();
dump('after start2');