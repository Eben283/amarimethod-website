export type ConversationWorkState = 'needs_reply' | 'waiting' | 'done';

// The pilot starts a new owned work queue without turning the imported GHL
// backlog into hundreds of fake tasks. Older conversations remain in All.
export const PILOT_WORK_QUEUE_START_AT = Date.parse('2026-09-13T13:00:22Z');

const REACTION = /^(?:(?:liked|loved|laughed at|emphasized|questioned|disliked)\s+[“"].+[”"]|reacted\s+.+?\s+to\s+[“"].+[”"])\s*$/i;
const CLOSER_WORD = "(?:i'?m good|all good|we'?re good|likewise|thanks|thank you|thx|ty|no thanks|got it|sounds good|will do|cheers|no problem|much appreciated)";
const CLOSER = new RegExp(`^(?:${CLOSER_WORD}[\\s!.,👍🙏😊🙂]*)+$`, 'i');
const CLOSING_PHRASE = /\b(?:thanks?|thank you|much appreciated|appreciate(?:d| it)?|see you soon|wrong number|stop|i(?:'|’)ll do|i will certainly remember|hope so too|be well|have a great day)\b/i;
const ACTION_OR_QUESTION = /\?|\b(?:can|could|would|when|where|what|how|please|need|want|question|help|send|book|move|reschedule|cancel)\b/i;
const AUTOMATED_ACKNOWLEDGEMENT = /\b(?:thanks? for (?:calling|contacting)|sorry we missed your call|we (?:just )?(?:missed|saw we missed) (?:your|a) call|currently (?:closed|away)|business hours|will (?:respond|get back to you))\b/i;

export function isClearlyCompleteMessage(value: unknown) {
  const message = String(value || '').trim();
  if (!message) return true;
  if (REACTION.test(message)) return true;
  if (/^no communication mirrored yet\.?$/i.test(message)) return true;
  if (/^(?:stop|wrong number)[.!\s]*$/i.test(message)) return true;
  if (AUTOMATED_ACKNOWLEDGEMENT.test(message)) return true;
  if (message.length <= 80 && CLOSER.test(message)) return true;
  return CLOSING_PHRASE.test(message) && !ACTION_OR_QUESTION.test(message);
}

export function conversationWorkState(
  direction: string | null | undefined,
  preview: unknown,
  occurredAt: string | null | undefined,
): ConversationWorkState {
  const occurredAtMs = occurredAt ? Date.parse(occurredAt) : Number.NaN;
  if (!Number.isFinite(occurredAtMs) || occurredAtMs <= PILOT_WORK_QUEUE_START_AT) return 'done';
  if (direction === 'outbound') return 'waiting';
  if (direction === 'inbound' && !isClearlyCompleteMessage(preview)) return 'needs_reply';
  return 'done';
}
