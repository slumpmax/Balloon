'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { createSystem } = require('../docs/nes-runtime.js');
const ROM = require('../docs/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const PAL = require('../docs/nes-runtime.js').PALETTE;
const s = createSystem({ rom: ROM, headless: true });
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
function png(px, file) {
  const w = 256, h = 240;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    for (let x = 0; x < w; x++) {
      const i = px[y * w + x] * 3, o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = PAL[i]; raw[o + 1] = PAL[i + 1]; raw[o + 2] = PAL[i + 2];
    }
  }
  const data = zlib.deflateSync(raw);
  const buf = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, buf);
}
function cls() { ['left','right','up','down','A','B','start','sel'].forEach(b => s.setButton(0, b, false)); }
function run(n) { for (let i = 0; i < n; i++) s.frame(); }
function btn(b, hold) { cls(); s.setButton(0, b, true); run(hold || 4); s.setButton(0, b, false); }
run(60); s.frame(); png(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_title.png');
btn('start'); run(30); s.frame(); png(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_after_start.png');
btn('A'); run(30); s.frame(); png(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_after_a.png');
btn('A'); run(30); s.frame(); png(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_after_a2.png');
btn('start'); run(30); s.frame(); png(s.video.pixels, 'C:/Users/tom/AppData/Local/Temp/opencode/bb_after_start2.png');
console.log('done');