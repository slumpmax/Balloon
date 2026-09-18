'use strict';
const fs = require('fs');
const { createSystem } = require('../public/nes-runtime.js');
const ROM = require('../public/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const s = createSystem({ rom: ROM, headless: true });
function bmp(px, file) {
  const w = 256, h = 240;
  const PAL = require('../public/nes-runtime.js').PALETTE;
  const rowSize = (w * 3 + 3) & ~3;
  const data = Buffer.alloc(54 + rowSize * h);
  data.write('BM'); data.writeUInt32LE(54 + rowSize * h, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(w, 18); data.writeInt32LE(h, 22);
  data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = px[y * w + x] * 3;
      const o = 54 + (h - 1 - y) * rowSize + x * 3;
      data[o] = PAL[i + 2]; data[o + 1] = PAL[i + 1]; data[o + 2] = PAL[i];
    }
  }
  fs.writeFileSync(file, data);
}
function cls() { s.setButton(0, 'left', false); s.setButton(0, 'right', false); s.setButton(0, 'up', false); s.setButton(0, 'down', false); s.setButton(0, 'A', false); s.setButton(0, 'B', false); s.setButton(0, 'start', false); s.setButton(0, 'sel', false); }
function run(n) { for (let i = 0; i < n; i++) s.frame(); }
function btn(b, hold) { cls(); s.setButton(0, b, true); run(hold || 4); s.setButton(0, b, false); }
run(60); s.frame(); bmp(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_title.bmp');
btn('start'); run(30); s.frame(); bmp(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_after_start.bmp');
btn('A'); run(30); s.frame(); bmp(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_after_a.bmp');
btn('A'); run(30); s.frame(); bmp(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_after_a2.bmp');
btn('start'); run(30); s.frame(); bmp(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_after_start2.bmp');
console.log('done');