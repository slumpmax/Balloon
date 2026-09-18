'use strict';
/* runrep.cjs — ขับเกม headless ตามสคริปต์ปุ่มแล้ว dump สถานะ เพื่อรีโปรดิวซ์บั๊กค้าง/ภาพรวน
 * usage: node tools/runrep.cjs <game-id> "<script>" [dumpFrames...]
 * script:  "b:<btn>@<frame>[:<dur>]" หรือ "w:<n>"; คั่นด้วย ";"
 *   b:start@200:5  = กด start ตั้งแต่ frame 200 นาน 5 เฟรม
 * ตัวอย่าง: node tools/runrep.cjs kinnikuman "w:200;b:start@200:6;w:400" 240 300 400 500
 */
const path = require('path');
const argv = process.argv.slice(2);
const GAME_ID = argv[0];
const ROM = require(path.join(__dirname, '..', 'public', 'game', GAME_ID, GAME_ID + '.rom.js'));
const { createSystem, PALETTE } = require(path.join(__dirname, '..', 'public', 'nes-runtime.js'));
const sys = createSystem({ rom: ROM, headless: true });

const script = argv[1] || 'w:300';
const events = [];
let target = 0;
for (const tok of script.split(';')) {
  const t = tok.trim();
  const m = t.match(/^b:(\w+)@(\d+)(?::(\d+))?$/) || t.match(/^w:(\d+)$/);
  if (!m) { console.error('bad token: ' + t); process.exit(1); }
  if (t[0] === 'w') { target = Math.max(target, +m[1]); continue; }
  events.push({ btn: m[1], f: +m[2], d: +(m[3] || 1) });
  target = Math.max(target, +m[2] + +m[3]);
}
const dumps = argv.slice(2).map(Number);
const chars = ' .:-=+*#%@';
function activeSprites() {
  let n = 0;
  for (let i = 0; i < 64; i++) if (sys.ppu.oam[i * 4] < 0xEF) n++;
  return n;
}
function dump(tag) {
  console.log('===== [' + tag + '] frame ' + sys.getFrameCount() + ' PC=$' + sys.cpu.PC.toString(16).toUpperCase() +
    ' halted=' + sys.cpu.halted + ' sprites=' + (sys.ppu.mask & 0x10 ? activeSprites() : 0) +
    ' scrollX=' + sys.ppu.scrollX + ' scrollY=' + sys.ppu.scrollY + ' ctrl=' + sys.ppu.ctrl.toString(16).toUpperCase() +
    ' mask=' + sys.ppu.mask.toString(16).toUpperCase() + ' status=' + sys.ppu.status.toString(16).toUpperCase());
  const px = sys.video.pixels;
  for (let y = 0; y < 240; y += 6) {
    let line = '';
    for (let x = 0; x < 256; x += 3) {
      const i = px[y * 256 + x] * 3;
      const lum = 0.2126 * PALETTE[i] + 0.7152 * PALETTE[i + 1] + 0.0722 * PALETTE[i + 2];
      line += chars[Math.min(9, Math.floor(lum / 256 * 10))];
    }
    console.log(line);
  }
}
function heldButtons() {
  let s = '';
  for (const b in cur) if (cur[b]) s += b + ' ';
  return s;
}
const cur = {};
for (let f = 0; f <= target; f++) {
  for (const e of events) { if (e.f <= f && f < e.f + e.d) cur[e.btn] = true; else if (f === e.f + e.d || f === e.f) cur[e.btn] = (f >= e.f && f < e.f + e.d); }
  sys.setButton(0, 'start', !!cur.start);
  sys.setButton(0, 'sel', !!cur.sel);
  sys.setButton(0, 'A', !!cur.A);
  sys.setButton(0, 'B', !!cur.B);
  sys.setButton(0, 'left', !!cur.left);
  sys.setButton(0, 'right', !!cur.right);
  sys.setButton(0, 'up', !!cur.up);
  sys.setButton(0, 'down', !!cur.down);
  sys.frame();
  if (sys.cpu.halted) {
    console.log('!!! HALT at frame ' + sys.getFrameCount() + ' PC=$' + sys.cpu.PC.toString(16).toUpperCase() + ' (held: ' + heldButtons() + ')');
    dump('halt');
    break;
  }
  if (dumps.includes(sys.getFrameCount())) dump('f' + sys.getFrameCount());
}
console.log('final frame ' + sys.getFrameCount() + ' PC=$' + sys.cpu.PC.toString(16).toUpperCase() + ' halted=' + sys.cpu.halted);