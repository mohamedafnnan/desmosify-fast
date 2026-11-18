import test from 'node:test';
import assert from 'node:assert/strict';
import { resampleLuma, thumbnail } from '../src/lib/luma.ts';
import type { LumaSource, Rotation } from '../src/lib/luma.ts';

// 4x2 coded image:  1 2 3 4 / 5 6 7 8   (stride padded to 6 to exercise stride handling)
function coded(rotation: Rotation, flip = false): LumaSource {
  const data = new Uint8Array(12);
  data.set([1, 2, 3, 4], 0);
  data.set([5, 6, 7, 8], 6);
  return { data, offset: 0, stride: 6, packing: 'luma', width: 4, height: 2, rotation, flip };
}
const run = (s: LumaSource, w: number, h: number) => {
  const out = new Uint8Array(w * h);
  resampleLuma(s, w, h, out);
  return Array.from(out);
};

test('rotation 0 is identity (stride respected)', () => {
  assert.deepEqual(run(coded(0), 4, 2), [1, 2, 3, 4, 5, 6, 7, 8]);
});
test('rotation 90 turns the image clockwise', () => {
  assert.deepEqual(run(coded(90), 2, 4), [5, 1, 6, 2, 7, 3, 8, 4]);
});
test('rotation 180', () => {
  assert.deepEqual(run(coded(180), 4, 2), [8, 7, 6, 5, 4, 3, 2, 1]);
});
test('rotation 270 turns the image counter-clockwise', () => {
  assert.deepEqual(run(coded(270), 2, 4), [4, 8, 3, 7, 2, 6, 1, 5]);
});
test('horizontal flip', () => {
  assert.deepEqual(run(coded(0, true), 4, 2), [4, 3, 2, 1, 8, 7, 6, 5]);
});
test('downscale averages blocks', () => {
  const data = new Uint8Array(16);
  data.set([0, 0, 100, 100, 0, 0, 100, 100, 200, 200, 40, 40, 200, 200, 40, 40]);
  const s: LumaSource = { data, offset: 0, stride: 4, packing: 'luma', width: 4, height: 4, rotation: 0, flip: false };
  assert.deepEqual(run(s, 2, 2), [0, 100, 200, 40]);
});
test('rgba and bgra give the same luma for the same colour', () => {
  const px = (r: number, g: number, b: number, bgra: boolean) => new Uint8Array(bgra ? [b, g, r, 255] : [r, g, b, 255]);
  const mk = (bgra: boolean): LumaSource => ({ data: px(200, 100, 50, bgra), offset: 0, stride: 4, packing: bgra ? 'bgra' : 'rgba', width: 1, height: 1, rotation: 0, flip: false });
  assert.deepEqual(run(mk(false), 1, 1), run(mk(true), 1, 1));
});
test('thumbnail of a flat image is flat', () => {
  const luma = new Uint8Array(64 * 36).fill(77);
  const out = new Uint8Array(8 * 4);
  thumbnail(luma, 64, 36, 8, 4, out);
  assert.ok(out.every((v) => v === 77));
});
