import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeShareHash, encodeShareHash } from '../src/lib/desmos-share.ts';

const payload = {
  version: 1 as const,
  formulas: 'X=\\left[0,1,2\\right]\nY=\\left[0,1,0\\right]\nf=1\nK=2',
  mode: 'clip' as const,
  frameCount: 2,
  width: 200,
  height: 120,
  fps: 8,
};

test('encodes formulas and setup as a URL-safe fragment and round-trips exactly', async () => {
  const hash = await encodeShareHash(payload);
  assert.match(hash, /^#desmosify=1\.(gzip|json)\.[A-Za-z0-9_-]+$/);
  assert.equal(hash.includes('+'), false);
  assert.equal(hash.includes('/'), false);
  assert.deepEqual(await decodeShareHash(hash), payload);
});

test('ignores unrelated URL fragments', async () => {
  assert.equal(await decodeShareHash('#section-about'), null);
});

test('rejects incomplete, malformed, and oversized share fragments', async () => {
  await assert.rejects(decodeShareHash('#desmosify=1.gzip'), /incomplete/);
  await assert.rejects(decodeShareHash('#desmosify=1.gzip.not_valid+base64'), /malformed/);
  await assert.rejects(decodeShareHash(`#desmosify=1.gzip.${'a'.repeat(100_001)}`), /incomplete/);
});

test('rejects unsupported or invalid payloads', async () => {
  await assert.rejects(encodeShareHash({ ...payload, version: 2 } as never), /unsupported format/);
  await assert.rejects(encodeShareHash({ ...payload, width: 0 }), /invalid width/);
});
