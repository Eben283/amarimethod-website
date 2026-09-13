import { describe, expect, it } from 'vitest';
import { conversationWorkState } from './conversation-work-state';

describe('conversationWorkState', () => {
  it('keeps substantive inbound messages in Needs reply', () => {
    expect(conversationWorkState('inbound', 'Could we move Friday a little later?')).toBe('needs_reply');
    expect(conversationWorkState('inbound', 'Thanks, but I have a question about pricing.')).toBe('needs_reply');
  });

  it('treats provider reactions and bare acknowledgements as Done', () => {
    expect(conversationWorkState('inbound', 'Liked “You got it 👍”')).toBe('done');
    expect(conversationWorkState('inbound', 'Loved “Great! And yes.”')).toBe('done');
    expect(conversationWorkState('inbound', 'Thank you!')).toBe('done');
    expect(conversationWorkState('inbound', 'Got it 👍')).toBe('done');
  });

  it('treats outbound-last conversations as Waiting', () => {
    expect(conversationWorkState('outbound', 'See you Friday.')).toBe('waiting');
  });

  it('does not turn unknown direction into staff work', () => {
    expect(conversationWorkState(null, 'Message imported')).toBe('done');
  });
});
