'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { createSystem } = require('../public/nes-runtime.js');
const PAL = require('../public/nes-runtime.js').PALETTE;
const ROM = require('../public/game/baseball-usa-europe/baseball-usa-europe.rom.js');
function crc32(buf) {
  let c, t = 0;
  for (let i = 0; i < buf.length; i++) {
    c = (t ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t = (t >>> 8) ^ c;
  }
  return (t ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function pngSmall(px, file, sx, sy) {
  const w = 256 / sx, h = 240 / sy;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const i = px[(y * sy) * 256 + (x * sx)] * 3, o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = PAL[i]; raw[o + 1] = PAL[i + 1]; raw[o + 2] = PAL[i + 2];
    }
  }
  const buf = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, buf);
}
const s = createSystem({ rom: ROM, headless: true });
const cls = () => ['left','right','up','down','A','B','start','sel'].forEach(b => s.setButton(0, b, false));
const run = n => { for (let i = 0; i < n; i++) s.frame(); };
const btn = (b, h) => { cls(); s.setButton(0, b, true); run(h || 4); s.setButton(0, b, false); };
run(60); s.frame();
pngSmall(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_t_s.png', 2, 4);
btn('start'); run(30); s.frame();
pngSmall(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_s_s.png', 2, 4);
btn('A'); run(30); s.frame();
pngSmall(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_a_s.png', 2, 4);
console.log('done');