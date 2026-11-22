export type DesmosSharePayload = {
  version: 1;
  formulas: string;
  mode: 'frame' | 'clip';
  frameCount: number;
  width: number;
  height: number;
  fps: number;
};

const HASH_PREFIX = 'desmosify=1';
const MAX_TOKEN_LENGTH = 100_000;
const MAX_PAYLOAD_BYTES = 1_500_000;
const MAX_FORMULA_LENGTH = 1_400_000;
const MAX_TRANSFORMED_BYTES = 1_600_000;

function validatePayload(value: unknown): DesmosSharePayload {
  if (!value || typeof value !== 'object') throw new TypeError('This share link does not contain a drawing.');
  const payload = value as Partial<DesmosSharePayload>;
  if (payload.version !== 1) throw new TypeError('This share link uses an unsupported format.');
  if (typeof payload.formulas !== 'string' || payload.formulas.trim().length === 0 || payload.formulas.length > MAX_FORMULA_LENGTH) {
    throw new TypeError('The formulas in this share link are missing or too large.');
  }
  if (payload.mode !== 'frame' && payload.mode !== 'clip') throw new TypeError('This share link has an invalid drawing mode.');
  if (!Number.isInteger(payload.frameCount) || payload.frameCount! < 1 || payload.frameCount! > 1_000_000) {
    throw new TypeError('This share link has an invalid picture count.');
  }
  for (const [name, number] of [['width', payload.width], ['height', payload.height]] as const) {
    if (!Number.isInteger(number) || number! < 1 || number! > 100_000) throw new TypeError(`This share link has invalid ${name} bounds.`);
  }
  if (!Number.isFinite(payload.fps) || payload.fps! <= 0 || payload.fps! > 1_000) {
    throw new TypeError('This share link has an invalid playback speed.');
  }
  return payload as DesmosSharePayload;
}

async function transformBytes(input: Uint8Array, mode: 'compress' | 'decompress'): Promise<Uint8Array> {
  const stableCopy = new Uint8Array(input);
  const source = new Blob([stableCopy.buffer as ArrayBuffer]).stream();
  const transformer = mode === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip');
  const reader = source.pipeThrough(transformer).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_TRANSFORMED_BYTES) {
        await reader.cancel();
        throw new RangeError('This drawing is too large to fit safely in a share link. Try fewer pictures or simpler lines.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError('This share link is incomplete or malformed.');
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Return a versioned, URL-fragment-safe representation of a result. The original video is never included. */
export async function encodeShareHash(value: DesmosSharePayload): Promise<string> {
  const payload = validatePayload(value);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) throw new RangeError('This drawing is too large to fit safely in a share link. Try fewer pictures or simpler lines.');

  let codec = 'json';
  let encodedBytes: Uint8Array = bytes;
  if (typeof CompressionStream !== 'undefined') {
    encodedBytes = await transformBytes(bytes, 'compress');
    codec = 'gzip';
  }
  const token = encodeBase64Url(encodedBytes);
  if (token.length > MAX_TOKEN_LENGTH) throw new RangeError('This drawing is too large for a reliable share link. Try fewer pictures, a smaller drawing width, or simpler lines.');
  return `#${HASH_PREFIX}.${codec}.${token}`;
}

/** Decode a Desmosify share fragment. Unrelated URL fragments return null. */
export async function decodeShareHash(hash: string): Promise<DesmosSharePayload | null> {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment.startsWith(`${HASH_PREFIX}.`)) return null;
  const [prefix, codec, token, extra] = fragment.split('.');
  if (prefix !== HASH_PREFIX || extra !== undefined || !token || token.length > MAX_TOKEN_LENGTH) {
    throw new TypeError('This share link is incomplete. Copy the full link and try again.');
  }
  const bytes = decodeBase64Url(token);
  let raw = bytes;
  if (codec === 'gzip') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed share links. Try an up-to-date browser.');
    raw = await transformBytes(bytes, 'decompress');
  } else if (codec !== 'json') {
    throw new TypeError('This share link uses an unsupported format.');
  }
  if (raw.byteLength > MAX_PAYLOAD_BYTES) throw new RangeError('This share link contains too much data to open safely.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new TypeError('This share link is damaged or incomplete. Copy the full link and try again.');
  }
  return validatePayload(parsed);
}
