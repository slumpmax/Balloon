'use strict';
/* Headless verification: boots the transpiled Balloon Fight (6502->JS) in Node,
 * runs frames without DOM, and renders a frame as ASCII art. */
const path = require('path');
const os = require('os');
const fs = require('fs');

const GAME_DIR = path.join(__dirname, '..', 'public', 'game');
/* เลือกเกม: node tools/smoke.cjs [frames] [game-id] — เช่น smoke.cjs 180 nuts-milk-japan */
const gameId = process.argv[3] || fs.readdirSync(GAME_DIR).find(p => fs.existsSync(path.join(GAME_DIR, p, p + '.rom.js'))) || '';
const romFile = path.join(GAME_DIR, gameId, gameId + '.rom.js');
if (!fs.existsSync(romFile)) { console.error('rom not found: ' + romFile + ' — run npm run build first'); process.exit(1); }
const ROM = require(romFile);
const { createSystem } = require(path.join(__dirname, '..', 'public', 'nes-runtime.js'));

const sys = createSystem({ rom: ROM, headless: true });

const N = parseInt(process.argv[2] || '180', 10);
let lastPc = -1, stable = 0;
for (let i = 0; i < N; i++) {
  sys.frame();
  const pc = sys.cpu.PC;
  if (pc === lastPc) stable++; else { stable = 0; lastPc = pc; }
  if (sys.isHalted()) { console.log('!!! halted at $' + pc.toString(16).toUpperCase() + ' on frame ' + i); break; }
  if (i % 60 === 0) console.log('frame ' + i + '  PC=$' + pc.toString(16).toUpperCase() + '  A=' + sys.cpu.A.toString(16) + '  X=' + sys.cpu.X.toString(16) + '  Y=' + sys.cpu.Y.toString(16) + '  P=' + sys.cpu.P.toString(2).padStart(8, '0'));
}
console.log('frames: ' + sys.getFrameCount() + '  final PC=$' + sys.cpu.PC.toString(16).toUpperCase() + '  halted=' + sys.isHalted());

// update OAM-based status: render a frame and dump ASCII art
sys.frame();
const px = sys.video.pixels;
const chars = ' .:-=+*#%@';
const PAL = require(path.join(__dirname, '..', 'public', 'nes-runtime.js')).PALETTE;
const out = [];
for (let y = 0; y < 240; y += 3) {
  let line = '';
  for (let x = 0; x < 256; x += 2) {
    const i = px[y * 256 + x] * 3;
    const lum = 0.2126 * PAL[i] + 0.7152 * PAL[i + 1] + 0.0722 * PAL[i + 2];
    line += chars[Math.min(chars.length - 1, Math.floor(lum / 256 * chars.length))];
  }
  out.push(line);
}
console.log('--- frame (scaled 1/3v x 1/2h) ---');
console.log(out.join('\n'));

// sanity: palette + memory integrity
console.log('--- sanity ---');
console.log('PC resolvable after frames?', sys.cpu.halted ? 'NO' : 'YES');
console.log('cycles/frame:', require(path.join(__dirname, '..', 'public', 'nes-runtime.js')).CYCLES_PER_FRAME);