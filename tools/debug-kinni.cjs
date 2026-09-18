'use strict';
/* ดูว่าเกมอ่าน $4016/$4017 ตอนไหน + ctrl/mask เปลี่ยนตอนไหน */
const path = require('path');
const GAME_ID = process.argv[2] || 'kinnikuman-muscle-tag-match-japan';
const ROM = require(path.join(__dirname, '..', 'public', 'game', GAME_ID, GAME_ID + '.rom.js'));
const { createSystem } = require(path.join(__dirname, '..', 'public', 'nes-runtime.js'));
const sys = createSystem({ rom: ROM, headless: true });
const cpu = sys.cpu, ppu = sys.ppu;

const origR8 = cpu.r8;
let readLog = [];
cpu.r8 = function (a) {
  const v = origR8(a);
  if (a === 0x4016 || a === 0x4017) readLog.push({ f: sys.getFrameCount(), a, pc: cpu.PC.toString(16) });
  return v;
};

let prevCtrl = 0, prevMask = 0;
sys.setButton(0, 'start', false);
for (let f = 0; f < 1200; f++) {
  if (f === 300) sys.setButton(0, 'start', true);
  if (f === 306) sys.setButton(0, 'start', false);
  sys.frame();
  if (ppu.ctrl !== prevCtrl || ppu.mask !== prevMask) {
    console.log('f' + f + ' ctrl=$' + ppu.ctrl.toString(16) + ' mask=$' + ppu.mask.toString(16) + ' PC=$' + cpu.PC.toString(16));
    prevCtrl = ppu.ctrl; prevMask = ppu.mask;
  }
}
console.log('\nTotal $4016/$4017 reads:', readLog.length);
if (readLog.length > 0) console.log('First 20:', readLog.slice(0, 20).map(r => 'f' + r.f + ' $' + r.a.toString(16) + ' PC=$' + r.pc).join('\n'));
console.log('Last 10:', readLog.slice(-10).map(r => 'f' + r.f + ' $' + r.a.toString(16) + ' PC=$' + r.pc).join('\n'));