import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesmosGraphLink } from '../src/lib/desmos-links.ts';

test('accepts an HTTPS Desmos Graphing Calculator share link', () => {
  assert.equal(
    parseDesmosGraphLink(' https://www.desmos.com/calculator/abc123?lang=en '),
    'https://www.desmos.com/calculator/abc123?lang=en',
  );
});

test('accepts the canonical Desmos host', () => {
  assert.equal(parseDesmosGraphLink('https://desmos.com/calculator/abc123'), 'https://desmos.com/calculator/abc123');
});

test('rejects non-HTTPS, non-Desmos, and non-graph links', () => {
  assert.equal(parseDesmosGraphLink('http://www.desmos.com/calculator/abc123'), null);
  assert.equal(parseDesmosGraphLink('https://example.com/calculator/abc123'), null);
  assert.equal(parseDesmosGraphLink('https://www.desmos.com/geometry/abc123'), null);
  assert.equal(parseDesmosGraphLink('https://www.desmos.com.evil.example/calculator/abc123'), null);
});
