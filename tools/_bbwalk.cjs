'use strict';
const { createSystem } = require('../public/nes-runtime.js');
const ROM = require('../public/game/baseball-usa-europe/baseball-usa-europe.rom.js');
const s = createSystem({ rom: ROM, headless: true });
const cls = () => ['left','right','up','down','A','B','start','sel'].forEach(b => s.setButton(0, b, false));
const run = n => { for (let i = 0; i < n; i++) s.frame(); };
const btn = (b, h) => { cls(); s.setButton(0, b, true); run(h || 4); s.setButton(0, b, false); };
function sig(px) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < 256 * 240; i += 7) h = Math.imul(h ^ px[i], 16777619) >>> 0;
  return h.toString(16);
}
function snap(tag) {
  s.frame();
  console.log('--- ' + tag + ' PC=' + s.cpu.PC.toString(16).toUpperCase() + ' sig=' + sig(s.video.pixels) + ' ---');
}
/* try a menu sequence: title -> start -> A/A (team?) -> start */
run(60); 
snap('T0 title');
btn('start'); run(30); snap('T1 after start');
btn('A'); run(30); snap('T2 after A');
btn('A'); run(30); snap('T3 after A2');
btn('start'); run(30); snap('T4 after start2');
/* hold on and watch for attract */
for (let i = 0; i < 600; i++) {
  s.frame();
  if (i % 150 === 0) console.log('hold f' + i + ' PC=' + s.cpu.PC.toString(16).toUpperCase() + ' sig=' + sig(s.video.pixels));
}
snap('T5 after hold');
console.log('done');