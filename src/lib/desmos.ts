// Desmos expression export: lists of points drawn with polygon(), or a whole clip packed into one pair of lists.

import { splitContours } from './trace.ts';

const LIST_LIMIT = 9800;
const CHUNK_POINTS = 9000;
const MAX_FRAMES_PER_DESMOS_CHUNK = 40;
const GAP = 2;

const num = (v: number) => (Number.isNaN(v) ? '0/0' : String(Math.round(v * 100) / 100));
const list = (values: ArrayLike<number>) => {
  const parts: string[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) parts[i] = num(values[i]);
  return `\\left[${parts.join(',')}\\right]`;
};

/** One frame as exact polygon expressions, chunked to stay under Desmos' list limit. */
export function frameExpressions(pts: Float32Array): string[] {
  const contours = splitContours(pts);
  const lines: string[] = [];
  let xs: number[] = [];
  let ys: number[] = [];
  let group = 0;

  const flush = () => {
    if (xs.length === 0) return;
    const s = group === 0 ? '' : String(group);
    lines.push(`X_{p${s}}=${list(xs)}`, `Y_{p${s}}=${list(ys)}`, `\\operatorname{polygon}\\left(\\left(X_{p${s}},Y_{p${s}}\\right)\\right)`);
    xs = [];
    ys = [];
    group++;
  };

  for (const c of contours) {
    let n = c.length / 2;
    let step = 1;
    if (n > CHUNK_POINTS - GAP) step = Math.ceil(n / (CHUNK_POINTS - GAP));
    const count = Math.ceil(n / step);
    if (xs.length + GAP + count > CHUNK_POINTS) flush();
    if (xs.length > 0) for (let g = 0; g < GAP; g++) (xs.push(NaN), ys.push(NaN));
    for (let i = 0; i < n; i += step) (xs.push(c[i * 2]), ys.push(c[i * 2 + 1]));
    n = 0;
  }
  flush();
  return lines;
}

type Pt = { x: number; y: number };

function toPoints(c: Float32Array): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < c.length; i += 2) out.push({ x: c[i], y: c[i + 1] });
  return out;
}

function polylineLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}

function resample(points: Pt[], step: number): Pt[] {
  if (points.length < 2) return points.slice();
  const out: Pt[] = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    let travelled = step - carried;
    while (travelled <= length) {
      const t = travelled / length;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      travelled += step;
    }
    carried = (carried + length) % step;
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push(last);
  return out;
}

type Line = { points: Pt[]; length: number };

const MIN_SLOT = 4;
const BASE_STEP = 0.8;

export type ClipOptions = { budget: number; maxSlots: number };

/** Pack a clip into X / Y lists with one slot per contour rank; animate by sliding `f` from 1 to K. */
function packClipChunk(frames: Float32Array[], opts: ClipOptions): { lines: string[]; dropped: number } {
  const count = Math.max(1, frames.length);
  const budget = Math.min(LIST_LIMIT, Math.max(400, Math.floor(opts.budget)));
  const perFrame = Math.max(1, Math.floor(budget / count));
  const cap = Math.max(1, Math.floor(opts.maxSlots));

  let dropped = 0;
  const lines: Line[][] = frames.map((pts) => {
    const all = splitContours(pts).map((c) => {
      const points = toPoints(c);
      return { points, length: polylineLength(points) };
    });
    all.sort((a, b) => b.length - a.length);
    dropped += Math.max(0, all.length - cap);
    return all.slice(0, cap);
  });

  const slotCount = Math.min(Math.max(0, ...lines.map((f) => f.length)), Math.max(1, Math.floor(perFrame / MIN_SLOT)));
  if (slotCount === 0) return { lines: [], dropped };

  const sample = (step: number) => {
    const resampled = lines.map((f) => f.slice(0, slotCount).map((l) => (l.length > 0 ? resample(l.points, step) : l.points)));
    const lengths = new Array<number>(slotCount).fill(MIN_SLOT);
    for (const f of resampled) f.forEach((l, i) => (lengths[i] = Math.max(lengths[i], l.length)));
    return { step, resampled, lengths, total: lengths.reduce((a, b) => a + b, 0) };
  };

  const longest = new Array<number>(slotCount).fill(0);
  for (const f of lines) f.slice(0, slotCount).forEach((l, i) => (longest[i] = Math.max(longest[i], l.length)));
  const room = perFrame - 2 * slotCount;
  let s = sample(room > 0 ? Math.max(BASE_STEP, longest.reduce((a, b) => a + b, 0) / room) : BASE_STEP);
  for (let k = 0; k < 4 && s.total > perFrame; k++) s = sample(s.step * (s.total / perFrame) * 1.02);
  for (let k = 0; k < 2; k++) {
    const finer = Math.max(BASE_STEP, s.step * (s.total / perFrame));
    if (finer >= s.step) break;
    const c = sample(finer);
    if (c.total > perFrame) break;
    s = c;
  }

  // Trim any remaining overshoot from the widest slots.
  const lengths = s.lengths.slice();
  let total = lengths.reduce((a, b) => a + b, 0);
  while (total > perFrame) {
    let widest = 0;
    for (let i = 1; i < lengths.length; i++) if (lengths[i] > lengths[widest]) widest = i;
    if (lengths[widest] <= MIN_SLOT) break;
    lengths[widest]--;
    total--;
  }

  const offsets: number[] = [];
  let stride = 0;
  for (const l of lengths) (offsets.push(stride), (stride += l));

  const X = new Array<number>(count * stride).fill(NaN);
  const Y = new Array<number>(count * stride).fill(NaN);
  s.resampled.forEach((frame, f) =>
    frame.forEach((line, i) => {
      const base = f * stride + offsets[i];
      const n = Math.min(line.length, lengths[i]);
      for (let k = 0; k < n; k++) {
        X[base + k] = line[k].x;
        Y[base + k] = line[k].y;
      }
    }),
  );

  const range = (offset: number, length: number) => {
    const base = `\\left(f-1\\right)\\cdot ${stride}`;
    return `${base}+${offset + 1}...${base}+${offset + length}`;
  };
  const out = [`X=${list(X)}`, `Y=${list(Y)}`, 'f=1', `K=${count}`];
  for (let i = 0; i < slotCount; i++) {
    const from = range(offsets[i], lengths[i] - 1);
    const to = range(offsets[i] + 1, lengths[i] - 1);
    out.push(
      `\\left(\\left(1-t\\right)X\\left[${from}\\right]+tX\\left[${to}\\right],\\left(1-t\\right)Y\\left[${from}\\right]+tY\\left[${to}\\right]\\right)`,
    );
  }
  return { lines: out, dropped };
}

/** Split long clips into separate Desmos lists so every list stays below LIST_LIMIT. */
export function clipExpressions(frames: Float32Array[], opts: ClipOptions): { lines: string[]; dropped: number } {
  if (frames.length <= MAX_FRAMES_PER_DESMOS_CHUNK) return packClipChunk(frames, opts);

  const chunkCount = Math.ceil(frames.length / MAX_FRAMES_PER_DESMOS_CHUNK);
  const chunkSize = Math.ceil(frames.length / chunkCount);
  const lines = ['f=1', `K=${frames.length}`];
  let dropped = 0;
  let start = 0;
  let chunkIndex = 1;

  while (start < frames.length) {
    const end = Math.min(frames.length, start + chunkSize);
    const packed = packClipChunk(frames.slice(start, end), opts);
    dropped += packed.dropped;
    const xName = `X_{${chunkIndex}}`;
    const yName = `Y_{${chunkIndex}}`;
    for (const line of packed.lines) {
      if (line.startsWith('X=')) lines.push(`${xName}${line.slice(1)}`);
      else if (line.startsWith('Y=')) lines.push(`${yName}${line.slice(1)}`);
      else if (line.startsWith('f=') || line.startsWith('K=')) continue;
      else {
        const globalFrameOffset = start;
        const activeRange = `\\left\\{${start + 1}\\le f\\le ${end}\\right\\}`;
        lines.push(
          line
            .replaceAll('X\\left[', `${xName}\\left[`)
            .replaceAll('Y\\left[', `${yName}\\left[`)
            .replaceAll('\\left(f-1\\right)', `\\left(f-${globalFrameOffset}\\right)`) + activeRange,
        );
      }
    }
    start = end;
    chunkIndex++;
  }
  return { lines, dropped };
}

export const CLIP_LIST_LIMIT = LIST_LIMIT;
