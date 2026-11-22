export type ImportedExpression = {
  id?: string;
  latex: string;
  label?: string;
  color?: string;
  hidden?: boolean;
};

export type DesmosImport = {
  filename: string;
  format: 'desmos-json' | 'json-expressions' | 'plain-text';
  expressions: ImportedExpression[];
  viewport: { xmin: number; xmax: number; ymin: number; ymax: number } | null;
  sliders: string[];
  warnings: string[];
};

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const LATEX_KEYS = ['latex', 'formula', 'expression'] as const;

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function viewportFrom(value: unknown): DesmosImport['viewport'] {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const xmin = asNumber(source.xmin);
  const xmax = asNumber(source.xmax);
  const ymin = asNumber(source.ymin);
  const ymax = asNumber(source.ymax);
  return xmin !== null && xmax !== null && ymin !== null && ymax !== null ? { xmin, xmax, ymin, ymax } : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function collectExpressions(value: unknown, out: ImportedExpression[], depth = 0): void {
  if (depth > 8 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectExpressions(item, out, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const latex = LATEX_KEYS.find((key) => stringValue(record[key]));
  if (latex) {
    out.push({
      id: stringValue(record.id),
      latex: stringValue(record[latex])!,
      label: stringValue(record.label),
      color: stringValue(record.color),
      hidden: record.hidden === true,
    });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== 'latex' && key !== 'formula' && key !== 'expression') collectExpressions(child, out, depth + 1);
  }
}

function uniqueExpressions(expressions: ImportedExpression[]): ImportedExpression[] {
  const seen = new Set<string>();
  return expressions.filter((expression) => {
    const key = `${expression.id ?? ''}\u0000${expression.latex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findViewport(value: unknown, depth = 0): DesmosImport['viewport'] {
  if (depth > 8 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findViewport(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = viewportFrom(record.viewport) ?? viewportFrom(record.graphpaper);
  if (direct) return direct;
  for (const child of Object.values(record)) {
    const found = findViewport(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function sliderNames(expressions: ImportedExpression[]): string[] {
  const names = new Set<string>();
  for (const { latex } of expressions) {
    const match = latex.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*\+?\s*\d+)?)/);
    if (match) names.add(match[1]);
  }
  return [...names];
}

export function parseDesmosImport(text: string, filename = 'import.txt'): DesmosImport {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('That file is larger than 8 MB. Choose a smaller Desmos export.');
  const warnings: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The selected file is empty.');
  let format: DesmosImport['format'] = 'plain-text';
  let expressions: ImportedExpression[] = [];
  let viewport: DesmosImport['viewport'] = null;
  let parsedJson = false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    parsedJson = true;
    format = parsed && typeof parsed === 'object' && 'expressions' in parsed ? 'desmos-json' : 'json-expressions';
    collectExpressions(parsed, expressions);
    viewport = findViewport(parsed);
  } catch {
    // Desmos formulas are also commonly saved as one formula per line.
  }
  if (expressions.length === 0) {
    if (parsedJson) throw new Error('No Desmos formulas were found. Use a .desmos export, JSON with latex fields, or one formula per line.');
    expressions = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
      .map((latex) => ({ latex }));
    format = 'plain-text';
  }
  expressions = uniqueExpressions(expressions);
  if (expressions.length === 0) throw new Error('No Desmos formulas were found. Use a .desmos export, JSON with latex fields, or one formula per line.');
  if (!viewport) warnings.push('No graph bounds were found in this file.');
  const hidden = expressions.filter((expression) => expression.hidden).length;
  if (hidden) warnings.push(`${hidden} imported expression${hidden === 1 ? '' : 's'} are hidden in Desmos.`);
  return { filename, format, expressions, viewport, sliders: sliderNames(expressions), warnings };
}

export const IMPORT_MAX_BYTES = MAX_IMPORT_BYTES;
