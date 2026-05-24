import { toText } from '../../lib/text';

export const STREAM_TYPEWRITER_TICK_MS = 12;

export function takeStreamTypewriterChunk(buffer: string): { chunk: string; rest: string } {
  if (!buffer) return { chunk: '', rest: '' };
  // 加速输出：根据缓冲区大小动态调整每次输出的字符数
  // 小缓冲区：每次 1-3 个字符（保持打字机效果）
  // 大缓冲区：每次 8-16 个字符（快速追赶）
  const size = buffer.length > 800 ? 16 : buffer.length > 400 ? 12 : buffer.length > 200 ? 8 : buffer.length > 80 ? 4 : buffer.length > 32 ? 3 : 2;
  return { chunk: buffer.slice(0, size), rest: buffer.slice(size) };
}

export function isStreamTextPart(part: any): boolean {
  const type = toText(part?.type).trim();
  return type === 'text' || type === 'reasoning';
}

export function streamPartWriteField(field: string, _kind?: string): string {
  const key = toText(field).trim();
  return key || 'text';
}
