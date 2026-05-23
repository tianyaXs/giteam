import { toText } from '../../lib/text';

export const STREAM_TYPEWRITER_TICK_MS = 40;

export function takeStreamTypewriterChunk(buffer: string): { chunk: string; rest: string } {
  if (!buffer) return { chunk: '', rest: '' };
  const sentenceMatch = buffer.match(/^[\s\S]*?(?:[。！？!?…][）)"』」\s]*|\n)/);
  if (sentenceMatch?.[0] && sentenceMatch[0].length > 0 && sentenceMatch[0].length <= 120) {
    return { chunk: sentenceMatch[0], rest: buffer.slice(sentenceMatch[0].length) };
  }
  const size = buffer.length > 240 ? 8 : buffer.length > 96 ? 5 : buffer.length > 32 ? 3 : 2;
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
