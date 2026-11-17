import { EdgeDetector } from './edges.ts';
import { Tracer, type TraceOptions } from './trace.ts';

export type ProcessOptions = TraceOptions & { cutoff: number };

/** RGBA frame in, flat polyline buffer out. One instance per frame size. */
export class FrameProcessor {
  readonly w: number;
  readonly h: number;
  private readonly det: EdgeDetector;
  private readonly tracer: Tracer;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.det = new EdgeDetector(w, h);
    this.tracer = new Tracer(w, h);
  }

  process(rgba: Uint8ClampedArray | Uint8Array, opts: ProcessOptions): Float32Array {
    this.det.detectRgba(rgba, opts);
    return this.tracer.trace(this.det, opts);
  }

  processGray(gray: Uint8Array, opts: ProcessOptions): Float32Array {
    this.det.gray.set(gray);
    this.det.detectGray(opts);
    return this.tracer.trace(this.det, opts);
  }

  get edgePixels(): number {
    return this.det.acceptedCount;
  }
}

export const DEFAULT_PROCESS: ProcessOptions = {
  cutoff: 0.1,
  minLength: 4,
  tolerance: 0.6,
  smooth: true,
};

/** Mean and max absolute difference between two equally sized luma thumbnails. */
export function lumaDiff(a: Uint8Array, b: Uint8Array): { mean: number; max: number } {
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] > b[i] ? a[i] - b[i] : b[i] - a[i];
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / a.length, max };
}
