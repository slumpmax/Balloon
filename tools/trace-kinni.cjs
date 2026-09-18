'use strict';
/* trace 2000/2001/2005/2006/4014 writes + 0320/0321 stores + NMI across transition */
const path = require('path');
const GAME_ID = process.argv[2] || 'kinnikuman-muscle-tag-match-japan';
const ROM = require(path.join(__dirname, '..', 'public', 'game', GAME_ID, GAME_ID + '.rom.js'));
const { createSystem } = require(path.join(__dirname, '..', 'public', 'nes-runtime.js'));
const sys = createSystem({ rom: ROM, headless: true });
const cpu = sys.cpu, ppu = sys.ppu;

const origW = cpu.w8;
const F0 = 270, F1 = 315;
cpu.w8 = function (a, v) {
  const f = sys.getFrameCount();
  if (f >= F0 && f < F1 && (a === 0x2000 || a === 0x2001 || a === 0x2005 || a === 0x2006 || a === 0x4014)) {
    console.log('W' + ' f' + f + ' $' + a.toString(16) + '=' + v.toString(16) + ' PC=$' + cpu.PC.toString(16));
  }
  if (f >= F0 && f < F1 && (a === 0x0321 || a === 0x0320 || a === 0x0322 || a === 0x0324)) {
    console.log('RAM' + ' f' + f + ' [$' + a.toString(16) + ']=' + v.toString(16) + ' PC=$' + cpu.PC.toString(16));
  }
  return origW(a, v);
};
const origDoInt = cpu.doInt;
cpu.doInt = function () {
  const f = sys.getFrameCount();
  if (f >= F0 - 1 && f < F1) console.log('INT f' + f + ' nmi=' + cpu.nmi + ' irq=' + cpu.irq + ' I=' + (cpu.P & 4 ? 1 : 0) + ' PC=$' + cpu.PC.toString(16) + ' -> vec $' + (cpu.nmi ? '86B0' : '874C'));
  return origDoInt.call(this);
};

sys.setButton(0, 'start', false);
let prevC = 0, prevM = 0;
for (let f = 0; f < F1; f++) {
  if (f === 300) sys.setButton(0, 'start', true);
  if (f === 306) sys.setButton(0, 'start', false);
  sys.frame();
  if (ppu.ctrl !== prevC || ppu.mask !== prevM) {
    console.log('CTRL f' + f + ' ctrl=$' + ppu.ctrl.toString(16) + ' mask=$' + ppu.mask.toString(16) + ' PC=$' + cpu.PC.toString(16));
    prevC = ppu.ctrl; prevM = ppu.mask;
  }
}
console.log('END PC=$' + cpu.PC.toString(16) + ' 0321=' + (cpu.r8(0x0321).toString(16)) + ' 0320=' + cpu.r8(0x0320).toString(16));