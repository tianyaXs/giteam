import { toText } from '../../lib/text';

export const STREAM_TYPEWRITER_TICK_MS = 16;

export function takeStreamTypewriterChunk(buffer: string): { chunk: string; rest: string } {
  if (!buffer) return { chunk: '', rest: '' };
  const size = buffer.length > 320 ? 4 : buffer.length > 144 ? 3 : buffer.length > 48 ? 2 : 1;
  return { chunk: buffer.slice(0, size), rest: buffer.slice(size) };
}

export function isStreamTextPart(part: any): boolean {
  const type = toText(part?.type).trim();
  return type === 'text' || type === 'reasoning';
}

export function streamPartWriteField(field: string, kind?: string): string {
  const key = toText(field).trim();
  const type = toText(kind).trim();
  if (type === 'reasoning' || key === 'reasoning') return 'text';
  return key || 'text';
}
