'use strict';
/* export-hd.cjs — ส่งออกฉากเกมและตัวละครเป็นภาพ HD (1024×960, Scale2x 4x)
 *
 * ทำงาน headless: ขับเกมจริง (CPU 6502->JS + PPU runtime) ผ่านทุกฉากด้วย input
 * ที่กดผ่านตัวควบคุมจำลอง แล้วจับเฟรมจาก PPU ขยายด้วย scale2x สองรอบ (4x)
 * และตัดตัวละครออกจาก OAM เป็น PNG โปร่งใสแยก pose
 *
 * ผลลัพธ์: public/game/{game-id}/hd/
 *   screenshots/  title.png  gameplay-1p.png  gameplay-2p.png  balloon-trip.png  attract-demo.gif
 *   sprites/      player1-pose*.png  player1-sheet.png  player2-sheet.png  enemy-sheet.png  manifest.json
 */
const path = require('path');
const fs = require('fs');
const { encodePNG } = require('./png.cjs');
const { scale2xIndex, nearestRGBA, indicesToRGBA } = require('./scaler.cjs');
const { encodeGIF } = require('./gif.cjs');

const GAME_DIR = path.join(__dirname, '..', 'docs', 'game');

/* เลือกเกม: node tools/export-hd.cjs [game-id] — default = balloon-fight-usa */
const GAME_ID = process.argv[2] || 'balloon-fight-usa';
const romFile = path.join(GAME_DIR, GAME_ID, GAME_ID + '.rom.js');
if (!fs.existsSync(romFile)) { console.error('rom not found: ' + romFile + ' — run npm run build:' + GAME_ID + ' first'); process.exit(1); }
const ROM = require(romFile);
const { createSystem, PALETTE } = require(path.join(__dirname, '..', 'docs', 'nes-runtime.js'));

/* ต่อเกม: รูปแบบ composite ของตัวละคร (จากการ calibrate)
 *  - balloon-fight-usa: ผู้เล่น/ศัตรู = 2x3 tiles (16x24), P1 ที่ slot 8
 *  - nuts-milk-japan:   ผู้เล่น/ศัตรู = 2x2 tiles (16x16), P1 ที่ slot 8
 *  - gameSceneScript: ลำดับการขับฉาก (input script + จุดจับภาพ) */
const GAMES = {
  'balloon-fight-usa': {
    compositeW: 16, compositeH: 24, gridW: 2, gridH: 3,
    scenes: ['title', 'gameplay-1p', 'gameplay-2p', 'balloon-trip'],
  },
  'nuts-milk-japan': {
    compositeW: 16, compositeH: 16, gridW: 2, gridH: 2,
    scenes: ['title', 'gameplay-1p'],
    skipP2: true, /* โหมด 2 PLAYER เล่นสลับกัน — ไม่มี P2 บนจอพร้อม P1 */
  },
  /* เกมที่ยังไม่ calibrate ตัวละคร — export เฉพาะ title (+GIF) สำหรับ thumbnail เมนู */
  'baseball-usa-europe': { skipSprites: true, scenes: ['title'] },
  'kinnikuman-muscle-tag-match-japan': { skipSprites: true, scenes: ['title'] },
  'soccer-world': { skipSprites: true, scenes: ['title'] },
};
const GAME_CFG = GAMES[GAME_ID];
if (!GAME_CFG) { console.error('no config for game: ' + GAME_ID + ' — เพิ่มใน GAMES ก่อน'); process.exit(1); }

/* ------------------------------------------------------------ helpers */
function boot() { return createSystem({ rom: ROM, headless: true }); }

function press(sys, port, button, frames) {
  for (let i = 0; i < frames; i++) { sys.setButton(port, button, true); sys.frame(); }
  sys.setButton(port, button, false);
}

function snapIndex(sys) { return Uint8Array.from(sys.video.pixels); }

/* scene: index pixels -> scale2x x2 (4x) -> PNG 1024x960 */
function scenePNG(sys, file, pixels) {
  let s = scale2xIndex(pixels, 256, 240);
  s = scale2xIndex(s.data, s.w, s.h);
  const rgba = indicesToRGBA(s.data, s.w, s.h, PALETTE);
  fs.writeFileSync(path.join(SHOT_DIR, file), encodePNG(s.w, s.h, rgba));
  return { file, w: s.w, h: s.h };
}

function palIndex(sys, a) {
  a = (a - 0x3F00) & 0x1F;
  if (a >= 0x10 && (a & 3) === 0) a -= 0x10; /* $3F10/$14/$18/$1C mirror backdrop */
  return sys.ppu.vram[0x3F00 + a] & 0x3F;
}

function activeSprites(sys) {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const o = i * 4, y = sys.ppu.oam[o];
    if (y < 0xEF) out.push({ i, y, tile: sys.ppu.oam[o + 1], attr: sys.ppu.oam[o + 2], x: sys.ppu.oam[o + 3] });
  }
  return out;
}

/* cluster consecutive OAM slots into tile-grid composites (players/enemies)
 * ขนาด grid ต่อเกม (gridW x gridH tiles) จากค่าที่ calibrate ไว้ */
function findComposites(sys) {
  const act = activeSprites(sys);
  const bySlot = new Map(act.map(s => [s.i, s]));
  const groups = [];
  const GW = GAME_CFG.gridW, GH = GAME_CFG.gridH, need = GW * GH;
  for (let i = 0; i <= 64 - need; i++) {
    if (!bySlot.has(i)) continue;
    const base = bySlot.get(i);
    const cells = [];
    let ok = true;
    for (let k = 0; k < need; k++) {
      const s = bySlot.get(i + k);
      const cx = s ? s.x - base.x : -1;
      const cy = s ? s.y - base.y : -1;
      const gxOk = GW === 2 ? (cx === 0 || cx === 8) : cx === 0;
      const gyOk = GH === 3 ? (cy === 0 || cy === 8 || cy === 16) : (cy === 0 || cy === 8);
      if (!s || !gxOk || !gyOk) { ok = false; break; }
      cells.push(s);
    }
    if (!ok) continue;
    /* all cells must exist exactly once on the grid */
    const seen = new Set(cells.map(s => `${s.x - base.x},${s.y - base.y}`));
    if (seen.size !== need) continue;
    /* a real character composite shares one sub-palette (verified by calibration) */
    if (cells.some(s => (s.attr & 3) !== (base.attr & 3))) continue;
    groups.push({ firstSlot: i, x: base.x, y: base.y, cells });
    i += need - 1;
  }
  return groups;
}

/* cut a WxH composite into RGBA (transparent background), painting NES order:
 * lower OAM index = on top, so paint from highest index first */
function cutComposite(sys, g) {
  const vram = sys.ppu.vram;
  const CW = GAME_CFG.compositeW, CH = GAME_CFG.compositeH;
  const rgba = new Uint8Array(CW * CH * 4);
  const order = g.cells.slice().sort((a, b) => b.i - a.i);
  const spPat = (sys.ppu.ctrl & 0x08) ? 0x1000 : 0;
  for (const s of order) {
    const flipH = (s.attr & 0x40) !== 0, flipV = (s.attr & 0x80) !== 0;
    const palBase = (s.attr & 3) << 2;
    const chr = spPat + s.tile * 16;
    for (let dy = 0; dy < 8; dy++) {
      const cy = s.y + dy - g.y, t0 = vram[chr + (flipV ? 7 - dy : dy)], t1 = vram[chr + 8 + (flipV ? 7 - dy : dy)];
      for (let dx = 0; dx < 8; dx++) {
        const cx = s.x + dx - g.x;
        if (cx < 0 || cx >= CW || cy < 0 || cy >= CH) continue;
        const bit = flipH ? dx : 7 - dx;
        const pv = ((t0 >> bit) & 1) | (((t1 >> bit) & 1) << 1);
        if (pv === 0) continue;
        const ci = palIndex(sys, 0x3F10 + palBase + pv);
        const o = (cy * 16 + cx) * 4;
        rgba[o] = PALETTE[ci * 3]; rgba[o + 1] = PALETTE[ci * 3 + 1]; rgba[o + 2] = PALETTE[ci * 3 + 2]; rgba[o + 3] = 255;
      }
    }
  }
  return rgba;
}

const poseKey = g => g.cells.map(s => s.tile.toString(16) + '.' + s.attr).join('|');

/* collect one composite pose: key -> {rgba, count} (ข้ามเอฟเฟกต์ประกายไฟ/เม็ดกระจาย —
 * ตัวละครจริงมีพิกเซลทึบหนาแน่น >12% ของกล่อง 16x24) */
function addPose(store, sys, g, cap) {
  const rgba = cutComposite(sys, g);
  let opaque = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 255) opaque++;
  if (opaque < GAME_CFG.compositeW * GAME_CFG.compositeH * 0.12) return;
  const k = poseKey(g);
  const e = store.get(k);
  if (e) e.count++;
  else if (store.size < cap) store.set(k, { rgba, count: 1, key: k });
}

const P1_SLOT = 8;  /* calibration: P1 composite always occupies OAM slots 8-13 */
/* P2 = slot 14 เมื่อเข้าเกมด้วย Select x1 -> Start (ตรวจซ้ำแบบ dynamic ตอน runtime) */

/* scale a WxH RGBA cutout by 4x (nearest) and write */
function writeCutout(file, rgba) {
  const CW = GAME_CFG.compositeW, CH = GAME_CFG.compositeH;
  let s = nearestRGBA(rgba, CW, CH);
  s = nearestRGBA(s.data, s.w, s.h);
  fs.writeFileSync(file, encodePNG(s.w, s.h, s.data));
  return s;
}

function writeSheet(dir, name, poses, perRow) {
  if (!poses.length) return null;
  const tileW = GAME_CFG.compositeW * 4, tileH = GAME_CFG.compositeH * 4;
  const rows = Math.ceil(poses.length / perRow);
  const W = perRow * tileW, H = rows * tileH;
  const out = new Uint8Array(W * H * 4); /* fully transparent */
  poses.forEach((p, n) => {
    const gx = (n % perRow) * tileW, gy = Math.floor(n / perRow) * tileH;
    const big = nearestRGBA(nearestRGBA(p.rgba, GAME_CFG.compositeW, GAME_CFG.compositeH).data, GAME_CFG.compositeW * 2, GAME_CFG.compositeH * 2).data; /* scale -> 4x */
    for (let y = 0; y < tileH; y++) for (let x = 0; x < tileW; x++) {
      const s = (y * tileW + x) * 4, d = ((gy + y) * W + gx + x) * 4;
      out[d] = big[s]; out[d + 1] = big[s + 1]; out[d + 2] = big[s + 2]; out[d + 3] = big[s + 3];
    }
  });
  const file = path.join(dir, name);
  fs.writeFileSync(file, encodePNG(W, H, out));
  return { file: path.basename(file), w: W, h: H, poses: poses.length };
}

/* ------------------------------------------------------------ 1. scenes */
const OUT_DIR = path.join(GAME_DIR, GAME_ID, 'hd');
const SHOT_DIR = path.join(OUT_DIR, 'screenshots');
const SPR_DIR = path.join(OUT_DIR, 'sprites');
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(SPR_DIR, { recursive: true });
const manifest = { game: GAME_ID, mode: 'scale2x x2 = 4x (nearest-pixel, palette-index domain)', scenes: [], sprites: {} };

function titleTo(sys) { for (let i = 0; i < 240; i++) sys.frame(); }

/* ลำดับฉากต่อเกม — ทำงานตามชื่อที่ประกาศใน GAME_CFG.scenes */
const SCENE_RUNNERS = {
  title(sys) { titleTo(sys); return scenePNG(sys, 'title.png', snapIndex(sys)); },
  'gameplay-1p'(sys) {
    titleTo(sys);
    press(sys, 0, 'start', 5);
    for (let i = 0; i < 90; i++) sys.frame();
    return scenePNG(sys, 'gameplay-1p.png', snapIndex(sys));
  },
  'gameplay-2p'(sys) {
    titleTo(sys);
    press(sys, 0, 'sel', 5);
    for (let i = 0; i < 10; i++) sys.frame();
    press(sys, 0, 'start', 5);
    for (let i = 0; i < 90; i++) sys.frame();
    return scenePNG(sys, 'gameplay-2p.png', snapIndex(sys));
  },
  'balloon-trip'(sys) {
    titleTo(sys);
    press(sys, 0, 'sel', 5);
    for (let i = 0; i < 10; i++) sys.frame();
    press(sys, 0, 'sel', 5);
    for (let i = 0; i < 10; i++) sys.frame();
    press(sys, 0, 'start', 5);
    for (let i = 0; i < 110; i++) sys.frame();
    return scenePNG(sys, 'balloon-trip.png', snapIndex(sys));
  },
};

console.log(`[game: ${GAME_ID}] exporting ${GAME_CFG.scenes.length} scenes...`);
for (const scene of GAME_CFG.scenes) {
  const sys = boot();
  const runner = SCENE_RUNNERS[scene];
  if (!runner) { console.log('  (ข้าม — ไม่มี runner สำหรับฉาก "' + scene + '")'); continue; }
  manifest.scenes.push(runner(sys));
}

/* ------------------------------------------------------------ 2. attract demo GIF */
console.log('[GIF] attract demo...');
{
  const sys = boot();
  titleTo(sys);
  const frames = [];
  let prev = null;
  for (let f = 0; f < 1200; f++) {
    sys.frame();
    if (f >= 240 && f % 3 === 0) { /* sample ~20fps after title */
      let s = scale2xIndex(sys.video.pixels, 256, 240); /* 512x480 index frame */
      if (!prev || !bufEq(prev, s.data)) {
        frames.push({ indices: Uint8Array.from(s.data), delayMs: 50 });
        prev = Uint8Array.from(s.data);
      }
    }
  }
  console.log('  gif frames:', frames.length);
  /* NES palette ทั้ง 64 สี เป็น global palette (index = NES index ตรง ๆ) */
  const gifPal = new Uint8Array(64 * 3);
  for (let i = 0; i < 64; i++) { gifPal[i * 3] = PALETTE[i * 3]; gifPal[i * 3 + 1] = PALETTE[i * 3 + 1]; gifPal[i * 3 + 2] = PALETTE[i * 3 + 2]; }
  const gif = encodeGIF({ width: 512, height: 480, paletteRGB: gifPal, frames, loop: 0 });
  fs.writeFileSync(path.join(SHOT_DIR, 'attract-demo.gif'), gif);
  manifest.scenes.push({ file: 'attract-demo.gif', frames: frames.length, w: 512, h: 480, bytes: gif.length });
}
function bufEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

/* ------------------------------------------------------------ 3. character cutouts */
/* ทัวร์ท่าทางต่อเกม (จากการ calibrate) */
const TOURS = {
  'balloon-fight-usa': {
    p1: [
      { idle: 60 }, { right: 60 }, { idle: 30 },
      { B: 50 }, { right: 30, B: 50 }, { idle: 40 },
      { left: 60 }, { B: 60 }, { left: 40, B: 60 }, { idle: 40 },
    ],
    p2: [{ idle: 60 }, { left: 20 }, { B: 40 }, { idle: 30 }],
    enter2p(sys) { press(sys, 0, 'sel', 5); for (let i = 0; i < 10; i++) sys.frame(); press(sys, 0, 'start', 5); for (let i = 0; i < 60; i++) sys.frame(); },
    p2Finder(g) { return g.firstSlot !== P1_SLOT && g.x > 100; },
  },
  'nuts-milk-japan': {
    p1: [
      { idle: 60 }, { right: 60 }, { idle: 30 },
      { A: 50 }, { right: 30, A: 50 }, { idle: 40 },
      { left: 60 }, { left: 40, A: 60 }, { idle: 40 },
    ],
    p2: [{ idle: 40 }, { left: 20 }, { A: 30 }, { idle: 30 }],
    enter2p(sys) { /* N&M: ผู้เล่น 2 กด Start ที่ port2 ระหว่างเกม */ press(sys, 1, 'start', 5); for (let i = 0; i < 60; i++) sys.frame(); },
    p2Finder(g) { return g.firstSlot !== P1_SLOT; },
  },
};
const TOUR = TOURS[GAME_ID] || TOURS['balloon-fight-usa'];

if (GAME_CFG.skipSprites) {
  console.log('characters: (ข้าม — skipSprites: เกมนี้ยังไม่ calibrate ตัวละคร)');
}
if (!GAME_CFG.skipSprites) {

console.log('characters: motion tour (1P)...');
const p1 = new Map(), en = new Map();
{
  const sys = boot(); titleTo(sys);
  press(sys, 0, 'start', 5);
  for (const seg of TOUR.p1) {
    const held = Object.keys(seg).filter(k => k !== 'idle');
    for (const k of held) sys.setButton(0, k, true);
    for (let i = 0; i < (seg.idle || 60); i++) {
      sys.frame();
      if (sys.getFrameCount() % 2 === 0) {
        for (const g of findComposites(sys)) addPose(g.firstSlot === P1_SLOT ? p1 : en, sys, g, 48);
      }
    }
    for (const k of held) sys.setButton(0, k, false);
  }
}

console.log('characters: P2 tour...');
const p2 = new Map();
if (GAME_CFG.skipP2) {
  console.log('  (ข้าม — เกมนี้ไม่มี P2 พร้อมกันบนจอ)');
} else {
  const sys = boot(); titleTo(sys);
  press(sys, 0, 'start', 5);
  for (let i = 0; i < 60; i++) sys.frame();
  TOUR.enter2p(sys);
  let p2Slot = -1;
  for (const g of findComposites(sys)) {
    if (TOUR.p2Finder(g)) { p2Slot = g.firstSlot; break; }
  }
  console.log('  P2 slot =', p2Slot, p2Slot >= 0 ? '(พบ 2 ผู้เล่น)' : '(ตรวจไม่พบ — ไม่มี P2 sheet)');
  for (const seg of TOUR.p2) {
    const held = Object.keys(seg).filter(k => k !== 'idle');
    for (const k of held) sys.setButton(1, k, true);
    for (let i = 0; i < (seg.idle || 60); i++) {
      sys.frame();
      if (sys.getFrameCount() % 2 === 0) {
        for (const g of findComposites(sys)) {
          const store = g.firstSlot === P1_SLOT ? p1 : (g.firstSlot === p2Slot ? p2 : en);
          addPose(store, sys, g, 48);
        }
      }
    }
    for (const k of held) sys.setButton(1, k, false);
  }
}

/* write cutouts + sheets + manifest entries */
function emitPoses(dir, store, prefix, group) {
  const list = Array.from(store.values()).sort((a, b) => a.key < b.key ? -1 : 1);
  const entries = [];
  list.forEach((p, n) => {
    const file = `${prefix}-pose${String(n + 1).padStart(2, '0')}.png`;
    const s = writeCutout(path.join(dir, file), p.rgba);
    entries.push({ file, w: s.w, h: s.h, oamTiles: p.key.split('|').map(t => '0x' + t.split('.')[0]).join(','), occurrences: p.count });
  });
  if (!list.length) { console.log(`  ${group}: (ไม่มี pose — ข้าม)`); return; }
  const sheet = writeSheet(dir, `${prefix}-sheet.png`, list, 8);
  manifest.sprites[group] = { poses: entries.length, sheet, files: entries };
  console.log(`  ${group}: ${entries.length} poses, sheet ${sheet ? sheet.w + 'x' + sheet.h : '-'}`);
}
emitPoses(SPR_DIR, p1, 'player1', 'player1');
emitPoses(SPR_DIR, p2, 'player2', 'player2');
emitPoses(SPR_DIR, en, 'enemy', 'enemy');

} /* end !skipSprites */

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('game:', GAME_ID, '| composite:', GAME_CFG.compositeW + 'x' + GAME_CFG.compositeH);
console.log('done ->', path.relative(process.cwd(), OUT_DIR));
for (const s of manifest.scenes) console.log('  ', s.file, s.w ? `${s.w}x${s.h}` : `${s.frames} frames`);
