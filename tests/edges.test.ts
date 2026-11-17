import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameProcessor, DEFAULT_PROCESS } from '../src/lib/frame.ts';
import { splitContours } from '../src/lib/trace.ts';

function canvas(w: number, h: number, draw: (set: (x: number, y: number) => void) => void): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  draw((x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = 0;
  });
  return rgba;
}

function discRgba(w: number, h: number, cx: number, cy: number, r: number): Uint8ClampedArray {
  return canvas(w, h, (set) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y);
  });
}

test('filled disc traces to one closed contour near the true radius', () => {
  const w = 160;
  const h = 120;
  const fp = new FrameProcessor(w, h);
  const pts = fp.process(discRgba(w, h, 80, 60, 30), DEFAULT_PROCESS);
  const contours = splitContours(pts);
  assert.equal(contours.length, 1, `expected one contour, got ${contours.length}`);
  const c = contours[0];
  const first = [c[0], c[1]];
  const last = [c[c.length - 2], c[c.length - 1]];
  assert.ok(Math.hypot(first[0] - last[0], first[1] - last[1]) < 1.5, 'contour should be closed');
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < c.length; i += 2) {
    const r = Math.hypot(c[i] - 80, c[i + 1] - (h - 60));
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  assert.ok(min > 28 && max < 32.5, `radius off: ${min}..${max}`);
  assert.ok(c.length / 2 < 120, `too many points after simplification: ${c.length / 2}`);
});

test('a bar traces to one closed outline with few vertices', () => {
  const w = 120;
  const h = 60;
  const rgba = canvas(w, h, (set) => {
    for (let x = 10; x < 110; x++) for (let t = -2; t <= 2; t++) set(x, 30 + t);
  });
  const fp = new FrameProcessor(w, h);
  const contours = splitContours(fp.process(rgba, DEFAULT_PROCESS));
  assert.equal(contours.length, 1);
  const c = contours[0];
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < c.length; i += 2) {
    minX = Math.min(minX, c[i]);
    maxX = Math.max(maxX, c[i]);
  }
  assert.ok(minX >= 9 && minX <= 12 && maxX >= 108 && maxX <= 111, `bbox ${minX}..${maxX}`);
  assert.ok(c.length / 2 <= 16, `outline not simplified: ${c.length / 2} points`);
});

test('two separate shapes give two contours', () => {
  const w = 200;
  const h = 100;
  const rgba = canvas(w, h, (set) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x - 50) ** 2 + (y - 50) ** 2 <= 400 || (x - 150) ** 2 + (y - 50) ** 2 <= 400) set(x, y);
    }
  });
  const fp = new FrameProcessor(w, h);
  assert.equal(splitContours(fp.process(rgba, DEFAULT_PROCESS)).length, 2);
});

test('flat frame produces no edges', () => {
  const w = 64;
  const h = 64;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(128);
  const fp = new FrameProcessor(w, h);
  assert.equal(fp.process(rgba, DEFAULT_PROCESS).length, 0);
});

test('detector is reusable across frames without leaking state', () => {
  const w = 96;
  const h = 96;
  const fp = new FrameProcessor(w, h);
  const a = fp.process(discRgba(w, h, 30, 30, 15), DEFAULT_PROCESS);
  const blank = fp.process(new Uint8ClampedArray(w * h * 4).fill(255), DEFAULT_PROCESS);
  const b = fp.process(discRgba(w, h, 30, 30, 15), DEFAULT_PROCESS);
  assert.equal(blank.length, 0);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test('noise-free tiny contrast is rejected by the absolute floor', () => {
  const w = 80;
  const h = 80;
  const rgba = new Uint8ClampedArray(w * h * 4).fill(200);
  for (let y = 0; y < h; y++) for (let x = 40; x < w; x++) {
    const p = (y * w + x) * 4;
    rgba[p] = rgba[p + 1] = rgba[p + 2] = 202;
  }
  const fp = new FrameProcessor(w, h);
  assert.equal(fp.process(rgba, DEFAULT_PROCESS).length, 0);
});
