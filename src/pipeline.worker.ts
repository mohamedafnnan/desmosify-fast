import { BlobSource, CanvasSink, Input, MATROSKA, MP4, QTFF, WEBM } from 'mediabunny';
import { FrameProcessor, lumaDiff } from './lib/frame.ts';
import { errorText } from './lib/types.ts';
import type { FrameMessage, PipelineIn, PipelineJob, PipelineOut } from './lib/types.ts';

const FORMATS = [MP4, QTFF, MATROSKA, WEBM];
const THUMB_W = 64;
const PROGRESS_EVERY = 4;

const port = self as unknown as {
  postMessage(message: PipelineOut): void;
  onmessage: ((event: MessageEvent<PipelineIn>) => void) | null;
};

type Track = NonNullable<Awaited<ReturnType<Input['getPrimaryVideoTrack']>>>;
type Opened = { runId: number; track: Track; t0: number };

let opened: Opened | null = null;
let processor: { key: string; fp: FrameProcessor } | null = null;
let cancelled = -1;
let connection: { runId: number; out: MessagePort } | null = null;

async function open(job: PipelineJob): Promise<Opened> {
  if (opened && opened.runId === job.runId) return opened;
  const input = new Input({ source: new BlobSource(job.file), formats: FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track found in this file.');
  if (!(await track.canDecode())) throw new Error('Your browser cannot decode this codec.');
  const t0 = await track.getFirstTimestamp();
  opened = { runId: job.runId, track, t0 };
  return opened;
}

function processorFor(w: number, h: number): FrameProcessor {
  const key = `${w}x${h}`;
  if (!processor || processor.key !== key) processor = { key, fp: new FrameProcessor(w, h) };
  return processor.fp;
}

async function run(job: PipelineJob): Promise<void> {
  const { params, runId } = job;
  if (!connection || connection.runId !== runId) throw new Error('Pipeline worker has no output port.');
  const out = connection.out;
  const { track, t0 } = await open(job);
  const { traceW: w, traceH: h } = params;
  const fp = processorFor(w, h);
  const sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });

  const thumbH = Math.max(8, Math.round((THUMB_W * h) / w));
  const thumb = new OffscreenCanvas(THUMB_W, thumbH);
  const thumbCtx = thumb.getContext('2d', { willReadFrequently: true })!;
  thumbCtx.imageSmoothingQuality = 'medium';
  const thumbLuma = new Uint8Array(THUMB_W * thumbH);
  let reference: Uint8Array | null = null;

  const times: number[] = [];
  for (let k = job.start; k < job.end; k++) times.push(t0 + k / params.fps);

  const stats = { frames: 0, reused: 0, decodeMs: 0, readMs: 0, traceMs: 0 };
  let sentProgress = 0;
  let sentReused = 0;

  const send = (index: number, pts: Float32Array | null) => {
    const message: FrameMessage = { index, pts };
    out.postMessage(message, pts ? [pts.buffer] : []);
  };

  const iterator = sink.canvasesAtTimestamps(times);
  let index = job.start;
  try {
    for (;;) {
      const t1 = performance.now();
      const { value, done } = await iterator.next();
      stats.decodeMs += performance.now() - t1;
      if (done) break;
      if (cancelled === runId) return;

      if (!value) {
        send(index, null);
        stats.reused++;
      } else {
        const { canvas } = value;
        let repeat = false;

        if (params.dedup) {
          const t2 = performance.now();
          thumbCtx.drawImage(canvas as OffscreenCanvas, 0, 0, THUMB_W, thumbH);
          const px = thumbCtx.getImageData(0, 0, THUMB_W, thumbH).data;
          for (let i = 0, p = 0; i < thumbLuma.length; i++, p += 4) {
            thumbLuma[i] = (px[p] * 77 + px[p + 1] * 150 + px[p + 2] * 29) >> 8;
          }
          stats.readMs += performance.now() - t2;
          if (reference) {
            const d = lumaDiff(reference, thumbLuma);
            repeat = d.mean < params.dedupMean && d.max < 40;
          }
          if (!repeat) reference = thumbLuma.slice();
        }

        if (repeat) {
          send(index, null);
          stats.reused++;
        } else {
          const t3 = performance.now();
          const ctx = (canvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
          const image = ctx.getImageData(0, 0, w, h);
          const t4 = performance.now();
          const pts = fp.process(image.data, params);
          stats.readMs += t4 - t3;
          stats.traceMs += performance.now() - t4;
          send(index, pts);
        }
      }

      stats.frames++;
      index++;
      if (stats.frames - sentProgress >= PROGRESS_EVERY) {
        port.postMessage({ type: 'progress', runId, frames: stats.frames - sentProgress, reused: stats.reused - sentReused });
        sentProgress = stats.frames;
        sentReused = stats.reused;
      }
    }
  } finally {
    void iterator.return?.(undefined);
  }

  // Source ended early: repeat the last picture so the encoder never waits on a missing index.
  for (; index < job.end; index++) {
    send(index, null);
    stats.frames++;
    stats.reused++;
  }

  port.postMessage({ type: 'progress', runId, frames: stats.frames - sentProgress, reused: stats.reused - sentReused });
  port.postMessage({ type: 'done', runId, start: job.start, end: job.end, stats });
}

port.onmessage = async (event) => {
  const message = event.data;
  if (message.type === 'connect') {
    connection = { runId: message.runId, out: message.out };
    return;
  }
  if (message.type === 'cancel') {
    cancelled = message.runId;
    if (opened?.runId === message.runId) opened = null;
    return;
  }
  try {
    await run(message);
  } catch (error) {
    port.postMessage({ type: 'error', runId: message.runId, message: errorText(error) });
  }
};
