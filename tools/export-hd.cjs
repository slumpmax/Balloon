'use strict';
/* export-hd.cjs — ส่งออกฉากเกมและตัวละครเป็นภาพ HD (1024×960, Scale2x 4x)
 *
 * ทำงาน headless: ขับเกมจริง (CPU 6502->JS + PPU runtime) ผ่านทุกฉากด้วย input
 * ที่กดผ่านตัวควบคุมจำลอง แล้วจับเฟรมจาก PPU ขยายด้วย scale2x สองรอบ (4x)
 * และตัดตัวละครออกจาก OAM เป็น PNG โปร่งใสแยก pose
 *
 * ผลลัพธ์: public/game/hd/
 *   screenshots/  title.png  gameplay-1p.png  gameplay-2p.png  balloon-trip.png  attract-demo.gif
 *   sprites/      player1-pose*.png  player1-sheet.png  player2-sheet.png  enemy-sheet.png  manifest.json
 */
const path = require('path');
const fs = require('fs');
const { encodePNG } = require('./png.cjs');
const { scale2xIndex, nearestRGBA, indicesToRGBA } = require('./scaler.cjs');
const { encodeGIF } = require('./gif.cjs');

const GAME_DIR = path.join(__dirname, '..', 'public', 'game');
const OUT_DIR = path.join(GAME_DIR, 'hd');
const SHOT_DIR = path.join(OUT_DIR, 'screenshots');
const SPR_DIR = path.join(OUT_DIR, 'sprites');

const romFile = fs.readdirSync(GAME_DIR).filter(f => f.endsWith('.rom.js'))[0];
if (!romFile) { console.error('no .rom.js found — run npm run build first'); process.exit(1); }
const ROM = require(path.join(GAME_DIR, romFile));
const { createSystem, PALETTE } = require(path.join(__dirname, '..', 'public', 'nes-runtime.js'));

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

/* cluster consecutive OAM slots into 2x3-tile (16x24) composites (players/enemies) */
function findComposites(sys) {
  const act = activeSprites(sys);
  const bySlot = new Map(act.map(s => [s.i, s]));
  const groups = [];
  for (let i = 0; i <= 58; i++) {
    if (!bySlot.has(i)) continue;
    const base = bySlot.get(i);
    const cells = [];
    let ok = true;
    for (let k = 0; k < 6; k++) {
      const s = bySlot.get(i + k);
      const cx = s ? s.x - base.x : -1;
      const cy = s ? s.y - base.y : -1;
      if (!s || (cx !== 0 && cx !== 8) || (cy !== 0 && cy !== 8 && cy !== 16)) { ok = false; break; }
      cells.push(s);
    }
    if (!ok) continue;
    /* all six cells must exist exactly once on the 2x3 grid */
    const seen = new Set(cells.map(s => `${s.x - base.x},${s.y - base.y}`));
    if (seen.size !== 6) continue;
    /* a real character composite shares one sub-palette (verified by calibration) */
    if (cells.some(s => (s.attr & 3) !== (base.attr & 3))) continue;
    groups.push({ firstSlot: i, x: base.x, y: base.y, cells });
    i += 5;
  }
  return groups;
}

/* cut a 16x24 composite into RGBA (transparent background), painting NES order:
 * lower OAM index = on top, so paint from highest index first */
function cutComposite(sys, g) {
  const vram = sys.ppu.vram;
  const rgba = new Uint8Array(16 * 24 * 4);
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
        if (cx < 0 || cx > 15 || cy < 0 || cy > 23) continue;
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
  if (opaque < 16 * 24 * 0.12) return;
  const k = poseKey(g);
  const e = store.get(k);
  if (e) e.count++;
  else if (store.size < cap) store.set(k, { rgba, count: 1, key: k });
}

const P1_SLOT = 8;  /* calibration: P1 composite always occupies OAM slots 8-13 */
/* P2 = slot 14 เมื่อเข้าเกมด้วย Select x1 -> Start (ตรวจซ้ำแบบ dynamic ตอน runtime) */

/* scale a 16x24 RGBA cutout by 4x (nearest) and write */
function writeCutout(file, rgba, w, h) {
  let s = nearestRGBA(rgba, w, h);
  s = nearestRGBA(s.data, s.w, s.h);
  fs.writeFileSync(file, encodePNG(s.w, s.h, s.data));
  return s;
}

function writeSheet(dir, name, poses, perRow) {
  if (!poses.length) return null;
  const tileW = 64, tileH = 96;
  const rows = Math.ceil(poses.length / perRow);
  const W = perRow * tileW, H = rows * tileH;
  const out = new Uint8Array(W * H * 4); /* fully transparent */
  poses.forEach((p, n) => {
    const gx = (n % perRow) * tileW, gy = Math.floor(n / perRow) * tileH;
    const big = nearestRGBA(nearestRGBA(p.rgba, 16, 24).data, 32, 48).data; /* scale 16x24 -> 64x96 */
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
fs.mkdirSync(SHOT_DIR, { recursive: true });
fs.mkdirSync(SPR_DIR, { recursive: true });
const manifest = { game: romFile.replace(/\.rom\.js$/, ''), mode: 'scale2x x2 = 4x (nearest-pixel, palette-index domain)', scenes: [], sprites: {} };

function titleTo(sys) { for (let i = 0; i < 240; i++) sys.frame(); }

console.log('[1/5] title screen...');
{
  const sys = boot(); titleTo(sys);
  manifest.scenes.push(scenePNG(sys, 'title.png', snapIndex(sys)));
}

console.log('[2/5] gameplay 1P...');
{
  const sys = boot(); titleTo(sys);
  press(sys, 0, 'start', 5);
  for (let i = 0; i < 90; i++) sys.frame(); /* spawn (~f10) + HUD ล่างเสร็จ */
  manifest.scenes.push(scenePNG(sys, 'gameplay-1p.png', snapIndex(sys)));
}

console.log('[3/5] gameplay 2P (Select x1 -> Start = โหมด 2 ผู้เล่น)...');
{
  const sys = boot(); titleTo(sys);
  press(sys, 0, 'sel', 5);
  for (let i = 0; i < 10; i++) sys.frame();
  press(sys, 0, 'start', 5);
  for (let i = 0; i < 90; i++) sys.frame(); /* spawn ทั้งคู่ (P1 x~32, P2 x~208) */
  manifest.scenes.push(scenePNG(sys, 'gameplay-2p.png', snapIndex(sys)));
}

console.log('[4/5] balloon trip (Select x2 -> Start)...');
{
  const sys = boot(); titleTo(sys);
  press(sys, 0, 'sel', 5);
  for (let i = 0; i < 10; i++) sys.frame();
  press(sys, 0, 'sel', 5);
  for (let i = 0; i < 10; i++) sys.frame();
  press(sys, 0, 'start', 5);
  for (let i = 0; i < 110; i++) sys.frame();
  const nAct = activeSprites(sys).length;
  manifest.scenes.push(scenePNG(sys, 'balloon-trip.png', snapIndex(sys)));
  if (nAct === 0) console.log('  (เตือน: balloon trip ไม่มีสไปรต์แอคทีฟ ณ เฟรมจับ — ตรวจภาพด้วยตาอีกครั้ง)');
}

/* ------------------------------------------------------------ 2. attract demo GIF */
console.log('[5/5] attract demo GIF...');
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
console.log('characters: motion tour (1P)...');
const p1 = new Map(), en = new Map();
{
  const sys = boot(); titleTo(sys);
  press(sys, 0, 'start', 5);
  /* ทัวร์ท่าทาง: idle -> เดินขวา -> ลอย (B) -> ลอย+เดิน -> เดินซ้าย -> ลอยกลางอากาศ */
  const script = [
    { idle: 60 }, { right: 60 }, { idle: 30 },
    { B: 50 }, { right: 30, B: 50 }, { idle: 40 },
    { left: 60 }, { B: 60 }, { left: 40, B: 60 }, { idle: 40 },
  ];
  for (const seg of script) {
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

console.log('characters: P2 tour (Select x1 -> Start)...');
const p2 = new Map();
{
  const sys = boot(); titleTo(sys);
  press(sys, 0, 'sel', 5);
  for (let i = 0; i < 10; i++) sys.frame();
  press(sys, 0, 'start', 5);
  for (let i = 0; i < 60; i++) sys.frame();
  /* P2 = composite ที่อยู่ครึ่งจอขวา (calibration: slot 14, x~208, pal ต่างจาก P1) */
  let p2Slot = -1;
  for (const g of findComposites(sys)) {
    if (g.firstSlot !== P1_SLOT && g.x > 100) { p2Slot = g.firstSlot; break; }
  }
  console.log('  P2 slot =', p2Slot, p2Slot >= 0 ? '(พบ 2 ผู้เล่น)' : '(ตรวจไม่พบ — ไม่มี P2 sheet)');
  /* ทัวร์ท่าทาง P2 แบบเบามือ (เริ่ม x~208 ใกล้ขอบขวา — เดินซ้าย/ลอยเท่านั้น) */
  const script = [{ idle: 60 }, { left: 20 }, { B: 40 }, { idle: 30 }];
  for (const seg of script) {
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
    const s = writeCutout(path.join(dir, file), p.rgba, 16, 24);
    entries.push({ file, w: s.w, h: s.h, oamTiles: p.key.split('|').map(t => '0x' + t.split('.')[0]).join(','), occurrences: p.count });
  });
  const sheet = writeSheet(dir, `${prefix}-sheet.png`, list, 8);
  manifest.sprites[group] = { poses: entries.length, sheet, files: entries };
  console.log(`  ${group}: ${entries.length} poses, sheet ${sheet ? sheet.w + 'x' + sheet.h : '-'}`);
}
emitPoses(SPR_DIR, p1, 'player1', 'player1');
emitPoses(SPR_DIR, p2, 'player2', 'player2');
emitPoses(SPR_DIR, en, 'enemy', 'enemy');

fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('done ->', path.relative(process.cwd(), OUT_DIR));
for (const s of manifest.scenes) console.log('  ', s.file, s.w ? `${s.w}x${s.h}` : `${s.frames} frames`);
