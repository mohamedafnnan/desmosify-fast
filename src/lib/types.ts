import type { DrawStyle } from './draw.ts';

export type Params = {
  traceW: number;
  traceH: number;
  /** Output frame rate; frame k is sampled at k / fps. */
  fps: number;
  cutoff: number;
  smooth: boolean;
  minLength: number;
  tolerance: number;
  dedup: boolean;
  /** Mean absolute luma difference (0..255) under which a frame counts as a repeat. */
  dedupMean: number;
};

export type PipelineConnect = { type: 'connect'; runId: number; out: MessagePort };

export type PipelineJob = {
  type: 'job';
  runId: number;
  file: File;
  start: number;
  end: number;
  params: Params;
};

export type PipelineCancel = { type: 'cancel'; runId: number };

export type PipelineIn = PipelineConnect | PipelineJob | PipelineCancel;

export type JobStats = {
  frames: number;
  reused: number;
  decodeMs: number;
  readMs: number;
  traceMs: number;
};

export type PipelineOut =
  | { type: 'progress'; runId: number; frames: number; reused: number }
  | { type: 'done'; runId: number; start: number; end: number; stats: JobStats }
  | { type: 'error'; runId: number; message: string };

/** Sent over the per-worker port. `pts: null` means "same picture as the previous frame". */
export type FrameMessage = { index: number; pts: Float32Array | null };

export type EncodeInit = {
  type: 'init';
  outW: number;
  outH: number;
  traceW: number;
  traceH: number;
  fps: number;
  total: number;
  style: DrawStyle;
  vfr: boolean;
  audio: File | null;
  ports: MessagePort[];
};

export type EncodeIn = EncodeInit | { type: 'abort' };

export type EncodeOut =
  | { type: 'encoded'; upTo: number }
  | { type: 'done'; blob: Blob; codec: string; ms: number }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string };

export type SourceInfo = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  frameCount: number;
  hasAudio: boolean;
  firstTimestamp: number;
};

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
