/**
 * 把 Pi SDK / 供应商原始错误收成用户可读的一句说明。
 * 保留关键细节（HTTP 码、余额不足等），去掉冗长信封。
 */
export function humanizeAgentError(raw: unknown): string {
  const text = (() => {
    if (typeof raw === 'string') return raw.trim();
    if (!raw) return '';
    if (typeof raw === 'object') {
      const row = raw as Record<string, unknown>;
      const msg = row.message ?? row.error ?? row.detail;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
      try {
        return JSON.stringify(raw);
      } catch {
        return String(raw);
      }
    }
    return String(raw).trim();
  })();
  if (!text) return '运行失败';

  if (/^(已暂停|已中止|aborted)$/i.test(text) || /中止|暂停|已停止/i.test(text)) {
    return /abort/i.test(text) && !/暂停|中止|停止/.test(text) ? '已暂停' : text;
  }

  // Pi SDK error: Provider error: zai: OpenAI API error (HTTP 429): {...}
  const providerMatch = text.match(
    /Provider error:\s*([^:]+):\s*(?:OpenAI API error\s*)?\(?(?:HTTP\s*)?(\d{3})\)?[:\s]*(.*)$/i
  );
  if (providerMatch) {
    const provider = (providerMatch[1] || '').trim();
    const code = (providerMatch[2] || '').trim();
    let detail = (providerMatch[3] || '').trim();
    detail = extractJsonMessage(detail) || detail;
    detail = detail.replace(/^["'{]+|["'}]+$/g, '').trim();
    const head = [provider, code ? `HTTP ${code}` : ''].filter(Boolean).join(' · ');
    if (detail) return `${head}: ${detail}`;
    return head || text;
  }

  const httpMatch = text.match(/HTTP\s*(\d{3})[:\s]*(.*)$/i);
  if (httpMatch) {
    const detail = extractJsonMessage((httpMatch[2] || '').trim()) || (httpMatch[2] || '').trim();
    return detail ? `HTTP ${httpMatch[1]}: ${detail}` : `HTTP ${httpMatch[1]}`;
  }

  const jsonMsg = extractJsonMessage(text);
  if (jsonMsg) return jsonMsg;

  return text
    .replace(/^Pi SDK error:\s*/i, '')
    .replace(/^Session error:\s*/i, '')
    .replace(/^Retry aborted$/i, '重试已中止')
    .trim() || '运行失败';
}

function extractJsonMessage(input: string): string {
  const raw = (input || '').trim();
  if (!raw) return '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return '';
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const err = parsed.error;
    if (err && typeof err === 'object') {
      const msg = (err as Record<string, unknown>).message;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // ignore
  }
  return '';
}
