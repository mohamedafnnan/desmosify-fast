import {
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  MATROSKA,
  MP4,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QTFF,
  WEBM,
  WebMOutputFormat,
} from 'mediabunny';
import type { InputAudioTrack, OutputFormat } from 'mediabunny';
import { FrameRenderer } from './lib/draw.ts';
import { errorText } from './lib/types.ts';
import type { EncodeIn, EncodeInit, EncodeOut, FrameMessage } from './lib/types.ts';

const CODECS = ['avc', 'vp9', 'av1'] as const;
const AUDIO_CODECS = ['aac', 'opus', 'vorbis', 'mp3'] as const;
const FORMATS = [MP4, QTFF, MATROSKA, WEBM];

const port = self as unknown as {
  postMessage(message: EncodeOut): void;
  onmessage: ((event: MessageEvent<EncodeIn>) => void) | null;
};

type AudioJob = { track: InputAudioTrack; source: AudioSampleSource };

async function openAudio(file: File, format: OutputFormat): Promise<AudioJob | null> {
  const input = new Input({ source: new BlobSource(file), formats: FORMATS });
  const track = await input.getPrimaryAudioTrack().catch(() => null);
  if (!track) return null;
  if (!(await track.canDecode())) throw new Error('This browser cannot decode the audio track.');
  const sourceChannels = await track.getNumberOfChannels();
  const numberOfChannels = Math.min(sourceChannels, 2);
  const sampleRate = await track.getSampleRate();
  const supported = new Set(format.getSupportedAudioCodecs());
  const codec = await getFirstEncodableAudioCodec(
    AUDIO_CODECS.filter((c) => supported.has(c)),
    { numberOfChannels, sampleRate, quality: QUALITY_HIGH },
  );
  if (!codec) throw new Error('This browser cannot encode the audio track.');
  const source = new AudioSampleSource({
    codec,
    quality: QUALITY_HIGH,
    transform: numberOfChannels < sourceChannels ? { numberOfChannels } : undefined,
  });
  return { track, source };
}

async function pumpAudio(job: AudioJob): Promise<void> {
  const sink = new AudioSampleSink(job.track);
  for await (const sample of sink.samples()) {
    try {
      await job.source.add(sample);
    } finally {
      sample.close();
    }
  }
  job.source.close();
}

let aborted = false;

async function encode(init: EncodeInit): Promise<void> {
  const started = performance.now();
  const { outW, outH, fps, total } = init;

  const codec = await getFirstEncodableVideoCodec([...CODECS], { width: outW, height: outH, frameRate: fps, quality: QUALITY_HIGH });
  if (!codec) throw new Error('This browser cannot encode video.');
  const format = codec === 'vp9' ? new WebMOutputFormat() : new Mp4OutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });

  let audio: AudioJob | null = null;
  if (init.audio) {
    try {
      audio = await openAudio(init.audio, format);
      if (!audio) port.postMessage({ type: 'notice', message: 'This source has no audio track; rendering video only.' });
    } catch (error) {
      port.postMessage({ type: 'notice', message: `Audio skipped: ${errorText(error)}` });
    }
  }
  if (audio) output.addAudioTrack(audio.source);

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d')!;
  const renderer = new FrameRenderer(outW, outH, init.traceW, init.traceH, init.style);
  const video = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });

  const pending = new Map<number, Float32Array | null>();
  let next = 0;
  let pumping = false;
  let finished = false;
  let current: Float32Array | null = null;
  let held: { ts: number; dur: number } | null = null;
  const dt = 1 / fps;

  await output.start();
  const audioTask = audio ? pumpAudio(audio) : null;
  void audioTask?.catch(() => undefined);

  const finish = async () => {
    if (finished) return;
    finished = true;
    if (held) await video.add(held.ts, held.dur);
    video.close();
    if (audioTask) await audioTask;
    await output.finalize();
    const mime = await output.getMimeType();
    port.postMessage({ type: 'done', blob: new Blob([target.buffer!], { type: mime }), codec, ms: performance.now() - started });
  };

  const encodeFrame = async (index: number, pts: Float32Array | null) => {
    const changed = pts !== null || index === 0;
    if (init.vfr) {
      if (changed) {
        if (held) await video.add(held.ts, held.dur);
        current = pts;
        renderer.draw(ctx, current);
        held = { ts: index * dt, dur: dt };
      } else if (held) {
        held.dur += dt;
      }
      return;
    }
    if (changed) {
      current = pts;
      renderer.draw(ctx, current);
    }
    await video.add(index * dt, dt);
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (!aborted && pending.has(next)) {
        const pts = pending.get(next)!;
        pending.delete(next);
        await encodeFrame(next, pts);
        next++;
        if (next % 4 === 0 || next === total) port.postMessage({ type: 'encoded', upTo: next });
      }
      if (!aborted && next >= total) await finish();
    } catch (error) {
      aborted = true;
      port.postMessage({ type: 'error', message: errorText(error) });
    } finally {
      pumping = false;
    }
  };

  for (const p of init.ports) {
    p.onmessage = (event: MessageEvent<FrameMessage>) => {
      pending.set(event.data.index, event.data.pts);
      void pump();
    };
  }
}

port.onmessage = async (event) => {
  const message = event.data;
  if (message.type === 'abort') {
    aborted = true;
    return;
  }
  aborted = false;
  try {
    await encode(message);
  } catch (error) {
    port.postMessage({ type: 'error', message: errorText(error) });
  }
};
