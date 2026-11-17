// Draws traced polylines in a Desmos-like look: white page, light grid, dark axes, blue strokes.

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export type DrawStyle = {
  grid: boolean;
  color: string;
  /** Stroke width in pixels at the output size. */
  lineWidth: number;
};

export const DEFAULT_COLOR = '#2464b4';

export function lineWidthFor(outHeight: number, base = 3): number {
  return Math.max(1, Math.round((base * outHeight) / 1080));
}

function niceStep(span: number, targetLines: number): number {
  const raw = span / targetLines;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

function makeCanvas(w: number, h: number): AnyCanvas {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

export class FrameRenderer {
  readonly outW: number;
  readonly outH: number;
  private readonly sx: number;
  private readonly sy: number;
  private readonly bg: AnyCanvas;
  private readonly style: DrawStyle;

  /** `traceW` x `traceH` is the coordinate space of the point buffers. */
  constructor(outW: number, outH: number, traceW: number, traceH: number, style: DrawStyle) {
    this.outW = outW;
    this.outH = outH;
    this.sx = outW / traceW;
    this.sy = outH / traceH;
    this.style = style;
    this.bg = makeCanvas(outW, outH);
    this.paintBackground(this.bg.getContext('2d') as Ctx, traceW, traceH);
  }

  private paintBackground(ctx: Ctx, traceW: number, traceH: number): void {
    const { outW, outH, sx, sy } = this;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    if (!this.style.grid) return;

    const unit = Math.max(1, outH / 1080);
    const major = niceStep(Math.max(traceW, traceH), 9);
    const minor = major / 5;

    const lines = (step: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let x = step; x < traceW; x += step) {
        const px = Math.round(x * sx) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, outH);
      }
      for (let y = step; y < traceH; y += step) {
        const py = outH - Math.round(y * sy) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(outW, py);
      }
      ctx.stroke();
    };
    lines(minor, '#ececec', unit);
    lines(major, '#c4c4c4', unit);

    ctx.strokeStyle = '#555555';
    ctx.lineWidth = 1.5 * unit;
    ctx.beginPath();
    ctx.moveTo(0.5 * unit, 0);
    ctx.lineTo(0.5 * unit, outH);
    ctx.moveTo(0, outH - 0.5 * unit);
    ctx.lineTo(outW, outH - 0.5 * unit);
    ctx.stroke();

    ctx.fillStyle = '#555555';
    ctx.font = `${Math.round(11 * unit)}px sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'center';
    for (let x = major; x < traceW - major * 0.4; x += major) {
      ctx.fillText(String(Math.round(x * 1e6) / 1e6), x * sx, outH - 4 * unit);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let y = major; y < traceH - major * 0.4; y += major) {
      ctx.fillText(String(Math.round(y * 1e6) / 1e6), 6 * unit, outH - y * sy);
    }
  }

  /** Paint the page and one frame's polylines onto `ctx` (any canvas of size outW x outH). */
  draw(ctx: Ctx, pts: Float32Array | null): void {
    ctx.drawImage(this.bg as CanvasImageSource, 0, 0);
    if (!pts || pts.length < 4) return;

    const { sx, sy, outH } = this;
    ctx.strokeStyle = this.style.color;
    ctx.lineWidth = this.style.lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i];
      if (x !== x) {
        pen = false;
        continue;
      }
      const px = x * sx;
      const py = outH - pts[i + 1] * sy;
      if (pen) ctx.lineTo(px, py);
      else {
        ctx.moveTo(px, py);
        pen = true;
      }
    }
    ctx.stroke();
  }
}
