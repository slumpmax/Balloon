'use strict';
/* Pixel-art upscalers used by the HD exporters.
 * - scale2xIndex: AdvanceMAME Scale2x on palette-index pixels (scenes) — one call = 2x.
 * - nearestRGBA : nearest-neighbor on RGBA (character cutouts keep alpha clean).
 * 4x output = scale2x twice (scenes) or nearest twice (sprites).
 */

/* Scale2x (AdvanceMAME) on an index buffer. Returns { w: 2w, h: 2h, data }.
 * For each source pixel E with orthogonal neighbors B(up) D(left) F(right) H(down):
 *   E0 = D==B && B!=F && D!=H ? D : E   E1 = B==F && B!=D && F!=H ? F : E
 *   E2 = D==H && D!=B && H!=F ? D : E   E3 = F==H && F!=B && H!=D ? F : E
 * Edge rows/cols clamp to the border pixel. */
function scale2xIndex(px, w, h) {
  const W = w * 2, H = h * 2;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) {
    const yUp = y > 0 ? y - 1 : 0, yDn = y < h - 1 ? y + 1 : h - 1;
    const r0 = (y * 2) * W, r1 = r0 + W;
    const rowU = yUp * w, rowM = y * w, rowD = yDn * w;
    for (let x = 0; x < w; x++) {
      const xL = x > 0 ? x - 1 : 0, xR = x < w - 1 ? x + 1 : w - 1;
      const B = px[rowU + x], D = px[rowM + xL], E = px[rowM + x], F = px[rowM + xR], H = px[rowD + x];
      const c = x * 2;
      out[r0 + c]     = (D === B && B !== F && D !== H) ? D : E;
      out[r0 + c + 1] = (B === F && B !== D && F !== H) ? F : E;
      out[r1 + c]     = (D === H && D !== B && H !== F) ? D : E;
      out[r1 + c + 1] = (F === H && F !== B && H !== D) ? F : E;
    }
  }
  return { w: W, h: H, data: out };
}

/* Nearest-neighbor 2x on RGBA (handles transparency without edge bleed). */
function nearestRGBA(rgba, w, h) {
  const W = w * 2, H = h * 2;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      for (let dy = 0; dy < 2; dy++) {
        const dRow = ((y * 2 + dy) * W + x * 2) * 4;
        for (let dx = 0; dx < 2; dx++) {
          const d = dRow + dx * 4;
          out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
        }
      }
    }
  }
  return { w: W, h: H, data: out };
}

/* Nearest-neighbor `times`x on RGBA (times = 2 or 4; implemented as repeated 2x). */
function nearestTimes(rgba, w, h, times) {
  let cur = { w, h, data: rgba };
  for (let i = 0; i < times / 2; i++) cur = nearestRGBA(cur.data, cur.w, cur.h);
  return cur;
}

/* Map palette-index pixels to RGBA using the NES master palette (r,g,b triplets). */
function indicesToRGBA(idx, w, h, PALETTE) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const p = idx[i] * 3, o = i * 4;
    out[o] = PALETTE[p]; out[o + 1] = PALETTE[p + 1]; out[o + 2] = PALETTE[p + 2]; out[o + 3] = 255;
  }
  return out;
}

module.exports = { scale2xIndex, nearestRGBA, nearestTimes, indicesToRGBA };
