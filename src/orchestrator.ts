import type {
  EncodeIn,
  EncodeOut,
  FrameMessage,
  JobStats,
  Params,
  PipelineIn,
  PipelineOut,
} from './lib/types.ts';
import { errorText } from './lib/types.ts';
import type { DrawStyle } from './lib/draw.ts';

export type Progress = { traced: number; reused: number; encoded: number; total: number; elapsedMs: number };

export type RunStats = {
  elapsedMs: number;
  frames: number;
  reused: number;
  threads: number;
  decodeMs: number;
  readMs: number;
  traceMs: number;
  encodeMs: number;
  codec: string;
  audio: 'copied' | 're-encoded' | 'none';
};

type Common = {
  file: File;
  params: Params;
  total: number;
  threads: number;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
};

export type CollectJob = Common;
export type RenderJob = Common & {
  outW: number;
  outH: number;
  style: DrawStyle;
  vfr: boolean;
  audio: File | null;
  onNotice?: (message: string) => void;
};

let runCounter = 0;

function chunkPlan(total: number, threads: number): { start: number; end: number }[] {
  const size = Math.min(96, Math.max(12, Math.ceil(total / (threads * 4))));
  const chunks: { start: number; end: number }[] = [];
  for (let start = 0; start < total; start += size) chunks.push({ start, end: Math.min(total, start + size) });
  return chunks;
}

type Engine = {
  workers: Worker[];
  channels: MessageChannel[];
  runId: number;
  stats: Omit<JobStats, 'frames' | 'reused'> & { frames: number; reused: number };
  finished: Promise<void>;
  setEncoded(n: number): void;
  stop(): void;
};

function startEngine(job: Common, windowed: boolean, onEncodedNeeded: boolean): Engine {
  const runId = ++runCounter;
  const threads = Math.max(1, Math.min(job.threads, 32));
  const chunks = chunkPlan(job.total, threads);
  const windowFrames = Math.max(...chunks.map((c) => c.end - c.start)) * threads * 2;
  const started = performance.now();

  const workers = Array.from({ length: threads }, () => new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' }));
  const channels = workers.map(() => new MessageChannel());
  const stats = { frames: 0, reused: 0, decodeMs: 0, readMs: 0, traceMs: 0 };

  let encoded = 0;
  let next = 0;
  let outstanding = 0;
  const idle: Worker[] = [];
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const finished = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
  void finished.catch(() => undefined);

  const progress = () =>
    job.onProgress?.({ traced: stats.frames, reused: stats.reused, encoded, total: job.total, elapsedMs: performance.now() - started });

  const assign = () => {
    while (idle.length > 0 && next < chunks.length) {
      if (windowed && chunks[next].start >= encoded + windowFrames) break;
      const worker = idle.pop()!;
      const chunk = chunks[next++];
      outstanding++;
      worker.postMessage({ type: 'job', runId, file: job.file, start: chunk.start, end: chunk.end, params: job.params } satisfies PipelineIn);
    }
    if (!onEncodedNeeded && next >= chunks.length && outstanding === 0) resolve();
  };

  const stop = () => {
    for (const w of workers) w.terminate();
    for (const c of channels) (c.port1.close(), c.port2.close());
  };

  workers.forEach((worker, i) => {
    worker.postMessage({ type: 'connect', runId, out: channels[i].port2 } satisfies PipelineIn, [channels[i].port2]);
    worker.onmessage = (event: MessageEvent<PipelineOut>) => {
      const m = event.data;
      if (m.type === 'progress') {
        stats.frames += m.frames;
        stats.reused += m.reused;
        progress();
      } else if (m.type === 'done') {
        stats.decodeMs += m.stats.decodeMs;
        stats.readMs += m.stats.readMs;
        stats.traceMs += m.stats.traceMs;
        outstanding--;
        idle.push(worker);
        assign();
      } else {
        reject(new Error(m.message));
      }
    };
    worker.onerror = (event) => reject(new Error(event.message || 'A pipeline worker crashed.'));
    idle.push(worker);
  });

  job.signal?.addEventListener('abort', () => {
    reject(new DOMException('Cancelled', 'AbortError'));
    stop();
  });

  assign();

  return {
    workers,
    channels,
    runId,
    stats,
    finished,
    setEncoded(n) {
      encoded = n;
      progress();
      assign();
    },
    stop,
  };
}

/** Trace frames and hand the polylines back (used for Desmos export + preview). */
export async function collectFrames(job: CollectJob): Promise<{ frames: Float32Array[]; stats: RunStats }> {
  const engine = startEngine(job, false, false);
  const slots: (Float32Array | null | undefined)[] = new Array(job.total);
  engine.channels.forEach((c) => {
    c.port1.onmessage = (event: MessageEvent<FrameMessage>) => {
      slots[event.data.index] = event.data.pts;
    };
  });

  try {
    await engine.finished;
    // Worker->port messages can trail the 'done' message on the main channel; give them a macrotask.
    await new Promise((r) => setTimeout(r, 30));
    const frames: Float32Array[] = [];
    let last: Float32Array = new Float32Array(0);
    for (let i = 0; i < job.total; i++) {
      const v = slots[i];
      if (v) last = v;
      frames.push(last);
    }
    const stats = engine.stats;
    return {
      frames,
      stats: {
        elapsedMs: 0,
        frames: stats.frames,
        reused: stats.reused,
        threads: engine.workers.length,
        decodeMs: stats.decodeMs,
        readMs: stats.readMs,
        traceMs: stats.traceMs,
        encodeMs: 0,
        codec: '',
        audio: 'none',
      },
    };
  } finally {
    engine.stop();
  }
}

/** Trace in parallel and encode a video, entirely off the main thread. */
export async function renderVideo(job: RenderJob): Promise<{ blob: Blob; stats: RunStats }> {
  const started = performance.now();
  const encoder = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
  const engine = startEngine(job, true, true);

  const result = new Promise<{ blob: Blob; codec: string; ms: number; audio: RunStats['audio'] }>((resolve, reject) => {
    encoder.onmessage = (event: MessageEvent<EncodeOut>) => {
      const m = event.data;
      if (m.type === 'encoded') engine.setEncoded(m.upTo);
      else if (m.type === 'notice') job.onNotice?.(m.message);
      else if (m.type === 'done') resolve({ blob: m.blob, codec: m.codec, ms: m.ms, audio: m.audio });
      else reject(new Error(m.message));
    };
    encoder.onerror = (event) => reject(new Error(event.message || 'The encoder crashed.'));
    job.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
  });

  const ports = engine.channels.map((c) => c.port1);
  encoder.postMessage(
    {
      type: 'init',
      outW: job.outW,
      outH: job.outH,
      traceW: job.params.traceW,
      traceH: job.params.traceH,
      fps: job.params.fps,
      total: job.total,
      style: job.style,
      vfr: job.vfr,
      audio: job.audio,
      ports,
    } satisfies EncodeIn,
    ports,
  );

  try {
    const finishedOrFailed = Promise.race([result, engine.finished.then(() => new Promise<never>(() => undefined))]);
    const done = await finishedOrFailed;
    const s = engine.stats;
    return {
      blob: done.blob,
      stats: {
        elapsedMs: performance.now() - started,
        frames: s.frames,
        reused: s.reused,
        threads: engine.workers.length,
        decodeMs: s.decodeMs,
        readMs: s.readMs,
        traceMs: s.traceMs,
        encodeMs: done.ms,
        codec: done.codec,
        audio: done.audio,
      },
    };
  } finally {
    engine.stop();
    encoder.terminate();
  }
}

export { errorText };
