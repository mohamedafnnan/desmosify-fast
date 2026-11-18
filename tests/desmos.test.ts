import test from 'node:test';
import assert from 'node:assert/strict';
import { clipExpressions, CLIP_LIST_LIMIT } from '../src/lib/desmos.ts';

function simpleFrame(): Float32Array {
  const points: number[] = [];
  for (let i = 0; i < 24; i++) {
    const angle = (2 * Math.PI * i) / 24;
    points.push(40 + 20 * Math.cos(angle), 40 + 20 * Math.sin(angle));
  }
  points.push(points[0], points[1], Number.NaN, Number.NaN);
  return new Float32Array(points);
}

test('long Desmos clips use bounded lists and a shared full-length frame slider', () => {
  const frameCount = 2700;
  const { lines } = clipExpressions(Array.from({ length: frameCount }, simpleFrame), { budget: 9800, maxSlots: 128 });

  assert.ok(lines.includes(`K=${frameCount}`));
  assert.ok(lines.includes('f=1'));
  const xLists = lines.filter((line) => line.startsWith('X_{'));
  const yLists = lines.filter((line) => line.startsWith('Y_{'));
  assert.equal(xLists.length, 68);
  assert.equal(yLists.length, 68);
  for (const line of [...xLists, ...yLists]) {
    const body = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']'));
    assert.ok(body.split(',').length <= CLIP_LIST_LIMIT);
  }
  const firstChunkShape = lines.find((line) => line.includes('\\left\\{1\\le f\\le 40\\right\\}'));
  const secondChunkShape = lines.find((line) => line.includes('\\left\\{41\\le f\\le 80\\right\\}'));
  assert.ok(firstChunkShape?.includes('X_{1}\\left['));
  assert.ok(secondChunkShape?.includes('X_{2}\\left['));
  assert.ok(secondChunkShape?.includes('\\left(f-40\\right)'));
});
