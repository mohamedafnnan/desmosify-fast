// Turns a decoded frame's pixel buffer into a trace-sized luma image, applying rotation/flip.
// Works straight on the decoder's native planes (usually YUV), so no canvas and no GPU readback of RGBA.

export type Packing = 'luma' | 'rgba' | 'bgra';
export type Rotation = 0 | 90 | 180 | 270;

export type LumaSource = {
  data: Uint8Array;
  offset: number;
  stride: number;
  packing: Packing;
  width: number;
  height: number;
  rotation: Rotation;
  flip: boolean;
};

/** Area-style downscale (up to 4x4 taps per output pixel) of the displayed image into `dst` (outW x outH). */
export function resampleLuma(s: LumaSource, outW: number, outH: number, dst: Uint8Array): void {
  const swap = s.rotation === 90 || s.rotation === 270;
  const dispW = swap ? s.height : s.width;
  const dispH = swap ? s.width : s.height;
  const stepX = dispW / outW;
  const stepY = dispH / outH;
  const tx = Math.min(4, Math.max(1, Math.round(stepX)));
  const ty = Math.min(4, Math.max(1, Math.round(stepY)));
  const taps = tx * ty;
  const { data, offset, stride, packing } = s;
  const bpp = packing === 'luma' ? 1 : 4;
  const rIdx = packing === 'bgra' ? 2 : 0;
  const bIdx = packing === 'bgra' ? 0 : 2;

  const read = (x: number, y: number): number => {
    const p = offset + y * stride + x * bpp;
    return bpp === 1 ? data[p] : (data[p + rIdx] * 77 + data[p + 1] * 150 + data[p + bIdx] * 29) >> 8;
  };

  const direct = s.rotation === 0 && !s.flip;
  if (direct && bpp === 1 && outW === dispW && outH === dispH) {
    // Same size: plain row copies.
    for (let y = 0; y < outH; y++) {
      const from = offset + y * stride;
      dst.set(data.subarray(from, from + outW), y * outW);
    }
    return;
  }
  if (direct && bpp === 1) {
    // Fast path: no rotation, plain luma plane.
    const cols = new Int32Array(outW * tx);
    for (let ox = 0; ox < outW; ox++) {
      for (let i = 0; i < tx; i++) cols[ox * tx + i] = Math.min(dispW - 1, Math.floor((ox + (i + 0.5) / tx) * stepX));
    }
    for (let oy = 0; oy < outH; oy++) {
      const rows = new Array<number>(ty);
      for (let j = 0; j < ty; j++) rows[j] = offset + Math.min(dispH - 1, Math.floor((oy + (j + 0.5) / ty) * stepY)) * stride;
      const out = oy * outW;
      for (let ox = 0; ox < outW; ox++) {
        let acc = 0;
        const c = ox * tx;
        for (let j = 0; j < ty; j++) {
          const row = rows[j];
          for (let i = 0; i < tx; i++) acc += data[row + cols[c + i]];
        }
        dst[out + ox] = (acc / taps + 0.5) | 0;
      }
    }
    return;
  }

  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      let acc = 0;
      for (let j = 0; j < ty; j++) {
        const v = Math.min(dispH - 1, Math.floor((oy + (j + 0.5) / ty) * stepY));
        for (let i = 0; i < tx; i++) {
          let u = Math.min(dispW - 1, Math.floor((ox + (i + 0.5) / tx) * stepX));
          if (s.flip) u = dispW - 1 - u;
          let x: number;
          let y: number;
          switch (s.rotation) {
            case 90:
              x = v;
              y = s.height - 1 - u;
              break;
            case 180:
              x = s.width - 1 - u;
              y = s.height - 1 - v;
              break;
            case 270:
              x = s.width - 1 - v;
              y = u;
              break;
            default:
              x = u;
              y = v;
          }
          acc += read(x, y);
        }
      }
      dst[oy * outW + ox] = (acc / taps + 0.5) | 0;
    }
  }
}

/** Tiny luma thumbnail (sparse 3x3 taps per cell) used to spot repeated frames. */
export function thumbnail(luma: Uint8Array, w: number, h: number, tw: number, th: number, dst: Uint8Array): void {
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      let acc = 0;
      for (let j = 0; j < 3; j++) {
        const y = Math.min(h - 1, Math.floor(((ty + (j + 0.5) / 3) * h) / th));
        for (let i = 0; i < 3; i++) {
          const x = Math.min(w - 1, Math.floor(((tx + (i + 0.5) / 3) * w) / tw));
          acc += luma[y * w + x];
        }
      }
      dst[ty * tw + tx] = (acc / 9 + 0.5) | 0;
    }
  }
}
