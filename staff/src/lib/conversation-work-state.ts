export type ConversationWorkState = 'needs_reply' | 'waiting' | 'done';

const REACTION = /^(?:liked|loved|laughed at|emphasized|questioned|disliked)\s+[“"].+[”"]\s*$/i;
const CLOSER_WORD = "(?:i'?m good|all good|we'?re good|likewise|thanks|thank you|thx|ty|no thanks|got it|sounds good|will do|cheers|no problem|much appreciated)";
const CLOSER = new RegExp(`^(?:${CLOSER_WORD}[\\s!.,👍🙏😊🙂]*)+$`, 'i');

export function isClearlyCompleteMessage(value: unknown) {
  const message = String(value || '').trim();
  if (!message) return true;
  if (REACTION.test(message)) return true;
  return message.length <= 80 && CLOSER.test(message);
}

export function conversationWorkState(direction: string | null | undefined, preview: unknown): ConversationWorkState {
  if (direction === 'outbound') return 'waiting';
  if (direction === 'inbound' && !isClearlyCompleteMessage(preview)) return 'needs_reply';
  return 'done';
}
