// Fast integer Canny edge detector working on RGBA or luma input.
// Everything is allocated once per detector and reused between frames.

export type EdgeOptions = {
  /** 0..1, higher keeps fewer, stronger edges. Same semantics as the original app. */
  cutoff: number;
};

const SPREAD = 2.75;
const LOW_RATIO = 0.4;
/** Absolute gradient floor (blurred-luma units, 64 per gray level of step). Kills noise in flat frames. */
const MIN_HIGH = 64 * 9;

export const EDGE = 2;

export class EdgeDetector {
  readonly w: number;
  readonly h: number;
  readonly gray: Uint8Array;
  private readonly tmp: Uint16Array;
  private readonly blur: Uint16Array;
  private readonly mag: Uint16Array;
  private readonly dir: Uint8Array;
  /** 0 = nothing, 1 = non-max-suppressed survivor, 2 = accepted edge pixel */
  readonly state: Uint8Array;
  private readonly surv: Int32Array;
  /** Accepted edge pixel indices, in flood order. */
  readonly accepted: Int32Array;
  acceptedCount = 0;
  private survCount = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.gray = new Uint8Array(n);
    this.tmp = new Uint16Array(n);
    this.blur = new Uint16Array(n);
    this.mag = new Uint16Array(n);
    this.dir = new Uint8Array(n);
    this.state = new Uint8Array(n);
    this.surv = new Int32Array(n);
    this.accepted = new Int32Array(n);
  }

  /** Detect edges from RGBA pixels. Result is in `state`/`accepted`. */
  detectRgba(rgba: Uint8ClampedArray | Uint8Array, opts: EdgeOptions): void {
    const g = this.gray;
    const n = this.w * this.h;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      g[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    }
    this.detectGray(opts);
  }

  /** Detect edges from the luma already placed in `gray`. */
  detectGray(opts: EdgeOptions): void {
    this.reset();
    if (this.w < 7 || this.h < 7) return;
    this.gaussian();
    this.gradient();
    this.suppressAndThreshold(opts.cutoff);
  }

  private reset(): void {
    const { state, surv, accepted } = this;
    for (let k = 0; k < this.survCount; k++) state[surv[k]] = 0;
    for (let k = 0; k < this.acceptedCount; k++) state[accepted[k]] = 0;
    this.survCount = 0;
    this.acceptedCount = 0;
  }

  private gaussian(): void {
    const { w, h, gray, tmp, blur } = this;

    // Horizontal 1-4-6-4-1, scaled by 16 (max 4080).
    for (let y = 0; y < h; y++) {
      const row = y * w;
      const last = row + w - 1;
      for (let x = 0; x < 2; x++) {
        const i = row + x;
        tmp[i] =
          gray[Math.max(row, i - 2)] +
          4 * gray[Math.max(row, i - 1)] +
          6 * gray[i] +
          4 * gray[i + 1] +
          gray[i + 2];
      }
      for (let i = row + 2; i < last - 1; i++) {
        tmp[i] = gray[i - 2] + 4 * gray[i - 1] + 6 * gray[i] + 4 * gray[i + 1] + gray[i + 2];
      }
      for (let i = last - 1; i <= last; i++) {
        tmp[i] =
          gray[i - 2] +
          4 * gray[i - 1] +
          6 * gray[i] +
          4 * gray[Math.min(last, i + 1)] +
          gray[Math.min(last, i + 2)];
      }
    }

    // Vertical pass with clamped row offsets, result scaled by 16 (max 4080).
    for (let y = 0; y < h; y++) {
      const r0 = Math.max(0, y - 2) * w;
      const r1 = Math.max(0, y - 1) * w;
      const r2 = y * w;
      const r3 = Math.min(h - 1, y + 1) * w;
      const r4 = Math.min(h - 1, y + 2) * w;
      for (let x = 0; x < w; x++) {
        blur[r2 + x] = (tmp[r0 + x] + 4 * tmp[r1 + x] + 6 * tmp[r2 + x] + 4 * tmp[r3 + x] + tmp[r4 + x]) >> 4;
      }
    }
  }

  private gradient(): void {
    const { w, h, blur, mag, dir } = this;
    mag.fill(0);
    for (let y = 1; y < h - 1; y++) {
      let i = y * w + 1;
      for (let x = 1; x < w - 1; x++, i++) {
        const a = blur[i - w - 1];
        const b = blur[i - w];
        const c = blur[i - w + 1];
        const d = blur[i - 1];
        const f = blur[i + 1];
        const g = blur[i + w - 1];
        const hh = blur[i + w];
        const k = blur[i + w + 1];
        const gx = c + 2 * f + k - a - 2 * d - g;
        const gy = g + 2 * hh + k - a - 2 * b - c;
        const ax = gx < 0 ? -gx : gx;
        const ay = gy < 0 ? -gy : gy;
        mag[i] = ax + ay;
        // tan(22.5deg) ~ 106/256, tan(67.5deg) ~ 618/256
        dir[i] = (ay << 8) <= ax * 106 ? 0 : (ay << 8) > ax * 618 ? 2 : gx > 0 === gy > 0 ? 1 : 3;
      }
    }
  }

  private suppressAndThreshold(cutoff: number): void {
    const { w, h, mag, dir, state, surv, accepted } = this;
    let count = 0;
    let sum = 0;
    let sumSq = 0;

    for (let y = 1; y < h - 1; y++) {
      let i = y * w + 1;
      for (let x = 1; x < w - 1; x++, i++) {
        const m = mag[i];
        if (m === 0) continue;
        let n1: number;
        let n2: number;
        switch (dir[i]) {
          case 0:
            n1 = mag[i - 1];
            n2 = mag[i + 1];
            break;
          case 1:
            n1 = mag[i - w - 1];
            n2 = mag[i + w + 1];
            break;
          case 2:
            n1 = mag[i - w];
            n2 = mag[i + w];
            break;
          default:
            n1 = mag[i - w + 1];
            n2 = mag[i + w - 1];
            break;
        }
        // Strict on one side, non-strict on the other: avoids two-pixel-wide ridges on plateaus.
        if (m > n1 && m >= n2) {
          state[i] = 1;
          surv[count++] = i;
          sum += m;
          sumSq += m * m;
        }
      }
    }
    this.survCount = count;
    if (count === 0) return;

    const mean = sum / count;
    const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
    const t = cutoff < 0 ? 0 : cutoff > 1 ? 1 : cutoff;
    const high = Math.max(MIN_HIGH, mean + std * SPREAD * t * t);
    const low = high * LOW_RATIO;

    // Hysteresis as a flood fill over survivors, using `accepted` as the BFS queue.
    let tail = 0;
    for (let k = 0; k < count; k++) {
      const i = surv[k];
      if (mag[i] >= high) {
        state[i] = EDGE;
        accepted[tail++] = i;
      }
    }
    const o0 = -w - 1;
    const o1 = -w;
    const o2 = -w + 1;
    const o5 = w - 1;
    const o7 = w + 1;
    for (let head = 0; head < tail; head++) {
      const i = accepted[head];
      let j = i + o0;
      if (state[j] === 1 && mag[j] >= low) (state[j] = EDGE), (accepted[tail++] = j);
      j = i + o1;
      if (state[j] === 1 && mag[j] >= low) (state[j] = EDGE), (accepted[tail++] = j);
      j = i + o2;
      if (state[j] === 1 && mag[j] >= low) (state[j] = EDGE), (accepted[tail++] = j);
      j = i - 1;
      if (state[j] === 1 && mag[j] >= low) (state[j] = EDGE), (accepted[tail++] = j);
      j = i + 1;
      if (state[j] === 1 && mag[j] >= low) (state[j] = EDGE), (accepted[tail++] = j);
      j = i + o5;
      if (state[j] === 1 && mag[j] >= low) (state[j] = EDGE), (accepted[tail++] = j);
      j = i + w;
      if (state[j] === 1 && mag[j] >= low) (state[j] = EDGE), (accepted[tail++] = j);
      j = i + o7;
      if (state[j] === 1 && mag[j] >= low) (state[j] = EDGE), (accepted[tail++] = j);
    }
    this.acceptedCount = tail;
  }
}
