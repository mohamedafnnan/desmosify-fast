import { BlobSource, Input, MATROSKA, MP4, QTFF, VideoSampleSink, WEBM } from 'mediabunny';
import type { VideoSample } from 'mediabunny';
import { FrameProcessor, lumaDiff } from './lib/frame.ts';
import { resampleLuma, thumbnail } from './lib/luma.ts';
import type { LumaSource, Packing, Rotation } from './lib/luma.ts';
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

const YUV = new Set(['I420', 'I420A', 'I422', 'I422A', 'I444', 'I444A', 'NV12']);
let scratch = new Uint8Array(1 << 20);

/** Read the decoder's own pixels (no canvas) and resample luma into `dst` at trace size. */
async function lumaOf(sample: VideoSample, w: number, h: number, dst: Uint8Array): Promise<void> {
  let format: { format?: string } | undefined;
  let packing: Packing;
  const fmt = sample.format as string | null;
  if (fmt && YUV.has(fmt)) packing = 'luma';
  else if (fmt === 'RGBA' || fmt === 'RGBX') packing = 'rgba';
  else if (fmt === 'BGRA' || fmt === 'BGRX') packing = 'bgra';
  else {
    packing = 'rgba'; // 10-bit or unknown layouts: let the browser convert
    format = { format: 'RGBA' };
  }
  const options = format as VideoFrameCopyToOptions | undefined;
  const size = sample.allocationSize(options);
  if (scratch.length < size) scratch = new Uint8Array(Math.max(size, scratch.length * 2));
  const layout = await sample.copyTo(scratch, options);
  const source: LumaSource = {
    data: scratch,
    offset: layout[0].offset,
    stride: layout[0].stride,
    packing,
    width: sample.visibleRect.width,
    height: sample.visibleRect.height,
    rotation: sample.rotation as Rotation,
    flip: sample.flip,
  };
  resampleLuma(source, w, h, dst);
}

async function run(job: PipelineJob): Promise<void> {
  const { params, runId } = job;
  if (!connection || connection.runId !== runId) throw new Error('Pipeline worker has no output port.');
  const out = connection.out;
  const { track, t0 } = await open(job);
  const { traceW: w, traceH: h } = params;
  const fp = processorFor(w, h);
  const sink = new VideoSampleSink(track);

  const thumbH = Math.max(8, Math.round((THUMB_W * h) / w));
  const thumb = new Uint8Array(THUMB_W * thumbH);
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

  const iterator = sink.samplesAtTimestamps(times);
  let index = job.start;
  try {
    for (;;) {
      const t1 = performance.now();
      const { value: sample, done } = await iterator.next();
      stats.decodeMs += performance.now() - t1;
      if (done) break;
      if (cancelled === runId) {
        sample?.close();
        return;
      }

      if (!sample) {
        send(index, null);
        stats.reused++;
      } else {
        let repeat = false;
        try {
          const t2 = performance.now();
          await lumaOf(sample, w, h, fp.luma);
          stats.readMs += performance.now() - t2;
        } finally {
          sample.close();
        }

        if (params.dedup) {
          thumbnail(fp.luma, w, h, THUMB_W, thumbH, thumb);
          if (reference) {
            const d = lumaDiff(reference, thumb);
            repeat = d.mean < params.dedupMean && d.max < 40;
          }
          if (!repeat) reference = thumb.slice();
        }

        if (repeat) {
          send(index, null);
          stats.reused++;
        } else {
          const t4 = performance.now();
          const pts = fp.processLuma(params);
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
