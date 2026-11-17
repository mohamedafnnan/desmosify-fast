// Direct edge-pixel tracing: turns a thin edge map into smooth polylines
// without any vectorizer round trip. Output is a flat Float32Array of x,y pairs
// with a (NaN, NaN) pair between contours. y is flipped to math space (up).

import { EDGE, type EdgeDetector } from './edges.ts';

export type TraceOptions = {
  /** Drop dangling stubs / specks shorter than this many pixels. */
  minLength: number;
  /** Ramer-Douglas-Peucker tolerance in pixels. 0 disables simplification. */
  tolerance: number;
  /** Apply a light 1-2-1 smoothing to chains before simplifying. */
  smooth: boolean;
};

const VIS = 16;

class PointSink {
  data = new Float32Array(4096);
  length = 0;

  private grow(extra: number): void {
    if (this.length + extra <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Float32Array(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  push(x: number, y: number): void {
    this.grow(2);
    this.data[this.length++] = x;
    this.data[this.length++] = y;
  }

  gap(): void {
    if (this.length > 0) this.push(NaN, NaN);
  }

  take(): Float32Array {
    let end = this.length;
    if (end >= 2 && Number.isNaN(this.data[end - 2])) end -= 2;
    const out = this.data.slice(0, end);
    this.length = 0;
    return out;
  }
}

export class Tracer {
  private readonly w: number;
  private readonly h: number;
  private readonly tr: Uint8Array;
  private readonly sink = new PointSink();
  private readonly nb = new Int32Array(8);
  private readonly loc = new Int32Array(8);
  private path = new Int32Array(1024);
  private px = new Float32Array(1024);
  private py = new Float32Array(1024);
  private qx = new Float32Array(1024);
  private qy = new Float32Array(1024);
  private keep = new Uint8Array(1024);
  private stack = new Int32Array(2048);

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.tr = new Uint8Array(w * h);
  }

  trace(det: EdgeDetector, opts: TraceOptions): Float32Array {
    const { tr, sink } = this;
    const edge = det.state;
    const acc = det.accepted;
    const count = det.acceptedCount;
    const nb = this.nb;

    for (let k = 0; k < count; k++) tr[acc[k]] = this.degree(edge, acc[k], nb);

    // Chains that start at endpoints / junctions.
    for (let k = 0; k < count; k++) {
      const i = acc[k];
      const di = tr[i] & 15;
      if (di === 2 || di === 0) continue;
      const n = this.neighbors(edge, i, nb);
      const local = this.loc;
      for (let a = 0; a < n; a++) local[a] = nb[a];
      for (let a = 0; a < n; a++) {
        const m = local[a];
        const dm = tr[m] & 15;
        if (dm === 2) {
          if (tr[m] & VIS) continue;
        } else if (m < i) {
          continue; // single-step chain between two nodes, emitted from the smaller index
        }
        const length = this.walk(edge, i, m);
        const endDeg = tr[this.path[length - 1]] & 15;
        const dangling = di === 1 || endDeg === 1;
        if (dangling && length < opts.minLength) continue;
        this.emit(length, false, opts);
      }
    }

    // Whatever remains is made of closed loops.
    for (let k = 0; k < count; k++) {
      const i = acc[k];
      if ((tr[i] & 15) !== 2 || tr[i] & VIS) continue;
      const length = this.walkLoop(edge, i, count);
      if (length >= Math.max(opts.minLength, 4)) this.emit(length, true, opts);
    }

    for (let k = 0; k < count; k++) tr[acc[k]] = 0;
    return sink.take();
  }

  private degree(edge: Uint8Array, i: number, out: Int32Array): number {
    return this.neighbors(edge, i, out);
  }

  /** 4-neighbors, plus diagonals only when neither shared orthogonal pixel is set (kills staircase triangles). */
  private neighbors(edge: Uint8Array, i: number, out: Int32Array): number {
    const w = this.w;
    let n = 0;
    const N = edge[i - w] === EDGE;
    const S = edge[i + w] === EDGE;
    const E = edge[i + 1] === EDGE;
    const W = edge[i - 1] === EDGE;
    if (N) out[n++] = i - w;
    if (S) out[n++] = i + w;
    if (E) out[n++] = i + 1;
    if (W) out[n++] = i - 1;
    if (!N && !E && edge[i - w + 1] === EDGE) out[n++] = i - w + 1;
    if (!N && !W && edge[i - w - 1] === EDGE) out[n++] = i - w - 1;
    if (!S && !E && edge[i + w + 1] === EDGE) out[n++] = i + w + 1;
    if (!S && !W && edge[i + w - 1] === EDGE) out[n++] = i + w - 1;
    return n;
  }

  private ensurePath(n: number): void {
    if (n <= this.path.length) return;
    const size = Math.max(n, this.path.length * 2);
    const next = new Int32Array(size);
    next.set(this.path);
    this.path = next;
  }

  private walk(edge: Uint8Array, start: number, first: number): number {
    const { tr, nb } = this;
    let length = 0;
    this.ensurePath(length + 2);
    this.path[length++] = start;
    let prev = start;
    let cur = first;
    for (;;) {
      this.ensurePath(length + 2);
      this.path[length++] = cur;
      if ((tr[cur] & 15) !== 2) break;
      tr[cur] |= VIS;
      const n = this.neighbors(edge, cur, nb);
      let next = -1;
      for (let a = 0; a < n; a++) {
        if (nb[a] !== prev) {
          next = nb[a];
          break;
        }
      }
      if (next < 0) break;
      prev = cur;
      cur = next;
    }
    return length;
  }

  private walkLoop(edge: Uint8Array, start: number, limit: number): number {
    const { tr, nb } = this;
    let length = 0;
    this.ensurePath(2);
    this.path[length++] = start;
    tr[start] |= VIS;
    let n = this.neighbors(edge, start, nb);
    if (n === 0) return 1;
    let prev = start;
    let cur = nb[0];
    for (let step = 0; step < limit; step++) {
      if (cur === start) break;
      this.ensurePath(length + 2);
      this.path[length++] = cur;
      tr[cur] |= VIS;
      n = this.neighbors(edge, cur, nb);
      let next = -1;
      for (let a = 0; a < n; a++) {
        if (nb[a] !== prev) {
          next = nb[a];
          break;
        }
      }
      if (next < 0) break;
      prev = cur;
      cur = next;
    }
    this.ensurePath(length + 2);
    this.path[length++] = start;
    return length;
  }

  private ensurePoints(n: number): void {
    if (n <= this.px.length) return;
    const size = Math.max(n, this.px.length * 2);
    this.px = new Float32Array(size);
    this.py = new Float32Array(size);
    this.qx = new Float32Array(size);
    this.qy = new Float32Array(size);
    this.keep = new Uint8Array(size);
    this.stack = new Int32Array(size * 2);
  }

  private emit(length: number, closed: boolean, opts: TraceOptions): void {
    if (length < 2) return;
    const { w, path, sink } = this;
    this.ensurePoints(length);
    const { px, py } = this;
    for (let k = 0; k < length; k++) {
      const i = path[k];
      px[k] = (i % w) + 0.5;
      py[k] = ((i / w) | 0) + 0.5;
    }

    let n = length;
    let xs = px;
    let ys = py;

    if (opts.smooth && n >= 5) {
      // Two passes of 1-2-1; endpoints stay pinned so chains still meet at junctions.
      const { qx, qy } = this;
      for (let pass = 0; pass < 2; pass++) {
        const sx = pass === 0 ? px : qx;
        const sy = pass === 0 ? py : qy;
        const dx = pass === 0 ? qx : px;
        const dy = pass === 0 ? qy : py;
        dx[0] = sx[0];
        dy[0] = sy[0];
        dx[n - 1] = sx[n - 1];
        dy[n - 1] = sy[n - 1];
        for (let k = 1; k < n - 1; k++) {
          dx[k] = 0.25 * sx[k - 1] + 0.5 * sx[k] + 0.25 * sx[k + 1];
          dy[k] = 0.25 * sy[k - 1] + 0.5 * sy[k] + 0.25 * sy[k + 1];
        }
      }
      xs = px;
      ys = py;
    }

    const h = this.h;
    if (opts.tolerance > 0 && n > 2) {
      const keep = this.keep;
      this.rdp(xs, ys, n, opts.tolerance, keep);
      sink.gap();
      for (let k = 0; k < n; k++) if (keep[k]) sink.push(round2(xs[k]), round2(h - ys[k]));
    } else {
      sink.gap();
      for (let k = 0; k < n; k++) sink.push(round2(xs[k]), round2(h - ys[k]));
    }
    void closed;
  }

  private rdp(xs: Float32Array, ys: Float32Array, n: number, eps: number, keep: Uint8Array): void {
    keep.fill(0, 0, n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const stack = this.stack;
    let top = 0;
    stack[top++] = 0;
    stack[top++] = n - 1;
    const eps2 = eps * eps;
    while (top > 0) {
      const last = stack[--top];
      const first = stack[--top];
      if (last - first < 2) continue;
      const ax = xs[first];
      const ay = ys[first];
      const dx = xs[last] - ax;
      const dy = ys[last] - ay;
      const len2 = dx * dx + dy * dy;
      let worst = -1;
      let worstD = 0;
      for (let k = first + 1; k < last; k++) {
        let d2: number;
        if (len2 < 1e-12) {
          const ex = xs[k] - ax;
          const ey = ys[k] - ay;
          d2 = ex * ex + ey * ey;
        } else {
          const cross = (xs[k] - ax) * dy - (ys[k] - ay) * dx;
          d2 = (cross * cross) / len2;
        }
        if (d2 > worstD) {
          worstD = d2;
          worst = k;
        }
      }
      if (worst > 0 && worstD > eps2) {
        keep[worst] = 1;
        stack[top++] = first;
        stack[top++] = worst;
        stack[top++] = worst;
        stack[top++] = last;
      }
    }
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Split a flat NaN-separated point buffer into contours (arrays of [x, y, x, y, ...]). */
export function splitContours(pts: Float32Array): Float32Array[] {
  const out: Float32Array[] = [];
  let start = 0;
  for (let i = 0; i <= pts.length; i += 2) {
    if (i === pts.length || Number.isNaN(pts[i])) {
      if (i > start) out.push(pts.subarray(start, i));
      start = i + 2;
    }
  }
  return out;
}
