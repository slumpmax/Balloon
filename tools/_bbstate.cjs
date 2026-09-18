'use strict';
const { createSystem } = require('../public/nes-runtime.js');
const ROM = require('../public/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const s = createSystem({ rom: ROM, headless: true });
const cls = () => ['left','right','up','down','A','B','start','sel'].forEach(b => s.setButton(0, b, false));
const run = n => { for (let i = 0; i < n; i++) s.frame(); };
const btn = (b, h) => { cls(); s.setButton(0, b, true); run(h || 4); s.setButton(0, b, false); };
function stats(tag) {
  s.frame();
  const px = s.video.pixels;
  // per-scanline entropy (unique palette indices truncated to 4 bits)
  let n = 0, plain = 0;
  for (let y = 0; y < 240; y++) {
    const seen = new Set();
    for (let x = 0; x < 256; x += 4) seen.add(px[y * 256 + x]);
    if (seen.size <= 2) plain++;
  }
  console.log(tag, 'PC=' + s.cpu.PC.toString(16).toUpperCase(), 'scrollY=' + s.ppu.scrollY, 'scrollX=' + s.ppu.scrollX, 'ctrl=$' + s.ppu.ctrl.toString(16), 'mask=$' + s.ppu.mask.toString(16), 'halved=' + plain);
}
run(60); stats('title');
btn('start'); run(10); stats('start10');
for (let i = 0; i < 20; i++) s.frame();
stats('start30');
btn('A'); run(10); stats('A10');
for (let i = 0; i < 20; i++) s.frame();
stats('A30');
btn('A'); run(10); stats('A2-10');
for (let i = 0; i < 20; i++) s.frame();
stats('A2-30');
btn('start'); run(10); stats('start2-10');
for (let i = 0; i < 20; i++) s.frame();
stats('start2-30');
console.log('done');