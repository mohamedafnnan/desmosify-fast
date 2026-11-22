import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDesmosImport } from '../src/lib/desmos-import.ts';

test('inspects a Desmos graph JSON file with bounds and slider definitions', () => {
  const result = parseDesmosImport(JSON.stringify({
    version: 10,
    expressions: {
      list: [
        { id: '1', type: 'expression', color: '#c74440', latex: 'f=1', hidden: false },
        { id: '2', type: 'expression', latex: 'y=sin(x+f)' },
      ],
    },
    graph: { viewport: { xmin: 0, xmax: 1920, ymin: 0, ymax: 1080 } },
  }), 'drawing.json');
  assert.equal(result.format, 'desmos-json');
  assert.equal(result.expressions.length, 2);
  assert.deepEqual(result.viewport, { xmin: 0, xmax: 1920, ymin: 0, ymax: 1080 });
  assert.deepEqual(result.sliders, ['f']);
});

test('imports one formula per line and ignores comments', () => {
  const result = parseDesmosImport('# exported formulas\nx=1\ny=x+2\n\n// note', 'formulas.txt');
  assert.equal(result.format, 'plain-text');
  assert.deepEqual(result.expressions.map((expression) => expression.latex), ['x=1', 'y=x+2']);
});

test('rejects empty and formula-free imports', () => {
  assert.throws(() => parseDesmosImport('   ', 'empty.txt'), /empty/);
  assert.throws(() => parseDesmosImport('{"hello":"world"}', 'unknown.json'), /No Desmos formulas/);
});
