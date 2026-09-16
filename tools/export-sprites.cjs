'use strict';
/* Export every CHR tile of the ROM as PNG sprite sheets.
 * Decodes the 8KB pattern tables with the palette the game actually loads
 * into the PPU (captured by a short headless run), then writes PNGs with a
 * minimal built-in encoder (node:zlib) — no external dependencies.
 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const GAME_DIR = path.join(__dirname, '..', 'public', 'game');
const OUT_DIR = path.join(GAME_DIR, 'sprites');

const romFile = fs.readdirSync(GAME_DIR).filter(f => f.endsWith('.rom.js'))[0];
if (!romFile) { console.error('no .rom.js found in ' + GAME_DIR); process.exit(1); }
const ROM = require(path.join(GAME_DIR, romFile));
const { createSystem, PALETTE } = require(path.join(__dirname, '..', 'public', 'nes-runtime.js'));

/* ---- 1. run a few frames so the game initializes the PPU palette ---- */
const sys = createSystem({ rom: ROM, headless: true });
for (let i = 0; i < 120; i++) sys.frame();

function palIdx(a) {
  a = (a - 0x3F00) & 0x1F;
  if (a >= 0x10 && (a & 3) === 0) a -= 0x10; /* $3F10-$3F1C mirror backdrop slots */
  return sys.ppu.vram[0x3F00 + a] & 0x3F;
}
const backdrop = palIdx(0x3F00);
const palIndices = [];
for (let i = 0; i < 0x20; i++) palIndices.push(palIdx(0x3F00 + i));

/* ---- 2. decode one 8x8 tile as RGBA ---- */
/*  base: 0 -> background palettes ($3F00), 16 -> sprite palettes ($3F10) */
function tileRGBA(chr, tile, base, subpal) {
  const data = new Uint8Array(8 * 8 * 4);
  const t = tile * 16;
  for (let y = 0; y < 8; y++) {
    const p0 = chr[t + y], p1 = chr[t + 8 + y];
    for (let x = 0; x < 8; x++) {
      const bit = 7 - x;
      const v = ((p0 >> bit) & 1) | (((p1 >> bit) & 1) << 1);
      const ci = (v === 0) ? backdrop : palIdx(base + (subpal << 2) + v);
      const o = (y * 8 + x) * 4;
      data[o] = PALETTE[ci * 3]; data[o + 1] = PALETTE[ci * 3 + 1]; data[o + 2] = PALETTE[ci * 3 + 2];
      data[o + 3] = 255;
    }
  }
  return data;
}

/* ---- 3. compose a sheet: 16 tiles wide x 8 tiles tall, 4 sub-palette rows ---- */
function makeSheet(chrTable, base) {
  const w = 16 * 8, h = 8 * 8 * 4;
  const out = new Uint8Array(w * h * 4);
  for (let t = 0; t < 128; t++) {
    const cx = (t % 16) * 8, cy = (Math.floor(t / 16) * 8) * 4;
    for (let s = 0; s < 4; s++) {
      const rgba = tileRGBA(chrTable, t, base, s);
      for (let o = 0; o < 8 * 8 * 4; o++) {
        const col = o % (8 * 4), row = Math.floor(o / (8 * 4));
        out[((cy + s * 64 + row) * w + cx) * 4 + col] = rgba[o];
      }
    }
  }
  return { w, h, data: out };
}

/* ---- 4. minimal PNG encoder (RGBA, 8-bit) ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; /* bit depth 8, color type 6 = RGBA */
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const r0 = y * (stride + 1), r1 = y * stride;
    raw[r0] = 0; /* filter: none */
    for (let x = 0; x < stride; x++) raw[r0 + 1 + x] = rgba[r1 + x];
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- 5. write outputs ---- */
fs.mkdirSync(OUT_DIR, { recursive: true });
const slug = path.basename(romFile).replace(/\.rom\.js$/, '');
for (let table = 0; table < 2; table++) {
  const chr = ROM.chr.subarray(table * 0x1000, (table + 1) * 0x1000);
  for (const [label, base] of [['sprite', 16], ['bg', 0]]) {
    const { w, h, data } = makeSheet(chr, base);
    const file = path.join(OUT_DIR, `${slug}-table${table}-${label}.png`);
    fs.writeFileSync(file, encodePNG(w, h, data));
    console.log('wrote', path.relative(process.cwd(), file), `(${w}x${h})`);
  }
}
const palMeta = {
  rom: romFile, backdrop: `#${palIndexHex(backdrop)}`,
  bg: range(0, 4).map(p => range(0, 4).map(i => '#' + palIndexHex(palIndices[(p << 2) + (i === 0 ? 0 : i)]))),
  sprite: range(0, 4).map(p => range(1, 4).map(i => '#' + palIndexHex(palIndices[16 + (p << 2) + i]))),
};
fs.writeFileSync(path.join(OUT_DIR, 'palette.json'), JSON.stringify(palMeta, null, 2));
console.log('wrote', 'public/game/sprites/palette.json');
console.log('backdrop:', palMeta.backdrop, 'bg0:', palMeta.bg[0].join(' '));

function palIndexHex(idx) {
  return PALETTE[idx * 3].toString(16).padStart(2, '0') + PALETTE[idx * 3 + 1].toString(16).padStart(2, '0') + PALETTE[idx * 3 + 2].toString(16).padStart(2, '0');
}
function range(a, b) { return Array.from({ length: b - a }, (_, i) => a + i); }