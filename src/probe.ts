import { BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } from 'mediabunny';
import type { SourceInfo } from './lib/types.ts';

export async function probe(file: File): Promise<SourceInfo> {
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, MATROSKA, WEBM] });
  try {
    if (!(await input.canRead())) throw new Error('Could not read this container. Use MP4, MOV, WebM or MKV.');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track found in this file.');
    if (!(await track.canDecode())) throw new Error('Your browser cannot decode this video codec.');
    const [width, height, stats, duration, first, audio] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.computePacketStats(),
      input.computeDuration(),
      track.getFirstTimestamp(),
      input.getPrimaryAudioTrack().catch(() => null),
    ]);
    const fps = Math.max(1, Math.min(120, stats.averagePacketRate || 30));
    return {
      width: Math.round(width),
      height: Math.round(height),
      fps,
      duration,
      frameCount: Math.max(1, stats.packetCount),
      hasAudio: audio !== null,
      firstTimestamp: first,
    };
  } finally {
    input.dispose?.();
  }
}
