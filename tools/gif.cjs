'use strict';
/* GIF89a encoder — global palette, looping animation, no dependencies.
 * LZW min code size derives from the palette size (>= 2 per spec).
 * decodeLZW is exported for round-trip self-tests (see tools/export-hd.cjs). */

/* --- LZW encode (early-change rule, battle-tested against browsers) --- */
function lzwEncode(minCodeSize, indices) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let table = new Map();

  const bytes = [];
  let bitBuf = 0, bitCnt = 0;
  function emit(code) {
    bitBuf |= code << bitCnt;
    bitCnt += codeSize;
    while (bitCnt >= 8) {
      bytes.push(bitBuf & 0xFF);
      bitBuf >>= 8; bitCnt -= 8;
    }
  }
  function resetDict() {
    table = new Map();
    nextCode = eoiCode + 1;
    codeSize = minCodeSize + 1;
  }

  emit(clearCode);
  let w = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (w << 8) | k;
    const c = table.get(key);
    if (c !== undefined) { w = c; continue; }
    emit(w);
    table.set(key, nextCode++);
    if (nextCode === 0x1000) {
      emit(clearCode);
      resetDict();
    } else if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
      codeSize++;
    }
    w = k;
  }
  emit(w);
  emit(eoiCode);
  if (bitCnt > 0) bytes.push(bitBuf & 0xFF);
  return Uint8Array.from(bytes);
}

/* --- LZW decode (spec rule: grow code size when table reaches 1<<size) --- */
function lzwDecode(minCodeSize, data) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  for (let i = 0; i < clearCode; i++) dict.push([i]);
  dict.push(null); dict.push(null); /* clear + eoi */

  const out = [];
  let bitPos = 0, prev = -1;
  const read = () => {
    const byte = bitPos >> 3;
    if (byte + 2 >= data.length + 1) { /* tolerate end */
      if (byte >= data.length) return null;
    }
    let v = 0;
    for (let b = 0; b < codeSize; b++) {
      const bit = (data[(bitPos >> 3)] >> (bitPos & 7)) & 1;
      v |= bit << b;
      bitPos++;
    }
    return v;
  };
  for (;;) {
    const code = read();
    if (code === null || code === undefined) break;
    if (code === clearCode) { codeSize = minCodeSize + 1; dict = []; for (let i = 0; i < clearCode; i++) dict.push([i]); dict.push(null); dict.push(null); prev = -1; continue; }
    if (code === eoiCode) break;
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev >= 0) entry = dict[prev].concat([dict[prev][0]]);
    else break;
    out.push(...entry);
    if (prev >= 0) {
      dict.push(dict[prev].concat([entry[0]]));
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return Uint8Array.from(out);
}

/* --- GIF89a file assembly --- */
function encodeGIF(opts) {
  const frames = opts.frames; /* [{ indices: Uint8Array, delayMs }] */
  const w = opts.width, h = opts.height;
  const pal = opts.paletteRGB; /* Uint8Array of r,g,b triplets (<= 256 entries) */
  const loop = opts.loop === undefined ? 0 : opts.loop;

  let palCount = pal.length / 3;
  let sizeBits = 1;
  while ((1 << (sizeBits + 1)) < palCount) sizeBits++;
  /* GCT holds 2^(sizeBits+1) entries; pad the table to that size */
  const gctEntries = 1 << (sizeBits + 1);
  const minCodeSize = Math.max(2, sizeBits + 1);

  const parts = [];
  parts.push(Buffer.from('GIF89a', 'ascii'));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(w, 0); lsd.writeUInt16LE(h, 2);
  lsd[4] = 0x80 | (7 << 4) | sizeBits; /* GCT present, color res 8, size */
  lsd[5] = 0; lsd[6] = 0;
  parts.push(lsd);
  const gct = Buffer.alloc(gctEntries * 3);
  gct.set(pal.subarray(0, Math.min(pal.length, gctEntries * 3)));
  parts.push(gct);

  /* NETSCAPE2.0 looping extension */
  if (loop !== null) {
    const app = Buffer.from([0x21, 0xFF, 0x0B]);
    parts.push(app, Buffer.from('NETSCAPE2.0', 'ascii'),
      Buffer.from([0x03, 0x01, loop & 0xFF, (loop >> 8) & 0xFF, 0x00]));
  }

  for (const f of frames) {
    const delay = Math.max(2, Math.round(f.delayMs / 10));
    const gce = Buffer.from([0x21, 0xF9, 0x04, 0x04, delay & 0xFF, (delay >> 8) & 0xFF, 0x00, 0x00]);
    parts.push(gce); /* disposal = 1 (do not dispose) */
    const id = Buffer.alloc(10);
    id[0] = 0x2C;
    /* layout: sel, left(2), top(2), width(2), height(2), flags */
    id.writeUInt16LE(w, 5); id.writeUInt16LE(h, 7);
    id[9] = 0; /* no local table, no interlace */
    parts.push(id);
    parts.push(Buffer.from([minCodeSize]));
    const lzw = lzwEncode(minCodeSize, f.indices);
    for (let o = 0; o < lzw.length; o += 255) {
      const seg = lzw.subarray(o, Math.min(o + 255, lzw.length));
      parts.push(Buffer.from([seg.length]), Buffer.from(seg));
    }
    parts.push(Buffer.from([0x00]));
  }
  parts.push(Buffer.from([0x3B]));
  return Buffer.concat(parts);
}

module.exports = { encodeGIF, lzwEncode, lzwDecode };
