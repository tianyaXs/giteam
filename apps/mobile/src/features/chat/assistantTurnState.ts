import { toText } from '../../lib/text';
import type { MobileChatMessage, MobileRenderedTurn } from '../../types';

export function turnHasAssistantRenderableContent(turn: MobileRenderedTurn): boolean {
  return turn.items.some((item) => {
    if (item.kind === 'think') return !!toText(item.card?.text).trim();
    if (item.kind === 'context') return true;
    if (item.kind === 'event' || item.kind === 'todo' || item.kind === 'question') return true;
    if (item.kind === 'chat' && item.message.role === 'assistant') {
      return !!toText(item.message.text).trim();
    }
    return false;
  });
}

export function conversationHasAssistantAfterUser(
  renderedTurns: MobileRenderedTurn[],
  messages: MobileChatMessage[]
): boolean {
  const lastTurn = renderedTurns[renderedTurns.length - 1];
  if (lastTurn && turnHasAssistantRenderableContent(lastTurn)) return true;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return false;
  for (let i = lastUserIdx + 1; i < messages.length; i += 1) {
    if (messages[i].role === 'assistant' && toText(messages[i].text).trim()) return true;
  }
  return false;
}
