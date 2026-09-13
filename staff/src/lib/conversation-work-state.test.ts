import { describe, expect, it } from 'vitest';
import { conversationWorkState } from './conversation-work-state';

describe('conversationWorkState', () => {
  it('keeps substantive inbound messages in Needs reply', () => {
    expect(conversationWorkState('inbound', 'Could we move Friday a little later?', '2026-09-13T13:01:00Z')).toBe('needs_reply');
    expect(conversationWorkState('inbound', 'Thanks, but I have a question about pricing.', '2026-09-13T13:01:00Z')).toBe('needs_reply');
  });

  it('treats provider reactions and bare acknowledgements as Done', () => {
    expect(conversationWorkState('inbound', 'Liked “You got it 👍”', '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'Loved “Great! And yes.”', '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'Reacted ☺️ to “Thank you”', '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'Thank you!', '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'Thanks Eben!', '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'Got it 👍', '2026-09-13T13:01:00Z')).toBe('done');
  });

  it('treats conversational endings and automated acknowledgements as Done', () => {
    expect(conversationWorkState('inbound', "Sounds amazing. Much appreciated I'm definitely doing the exercises you showed and I appreciate it a lot Dr. Garret.", '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'See you soon!', '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'Wrong number', '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'STOP', '2026-09-13T13:01:00Z')).toBe('done');
    expect(conversationWorkState('inbound', 'Hi thanks for calling. Sorry we missed you. Our team will respond during business hours.', '2026-09-13T13:01:00Z')).toBe('done');
  });

  it('keeps imported history out of the new work queue', () => {
    expect(conversationWorkState('inbound', 'Could we move Friday a little later?', '2026-09-13T12:59:59Z')).toBe('done');
    expect(conversationWorkState('outbound', 'Are you still interested?', '2026-09-13T12:59:59Z')).toBe('done');
    expect(conversationWorkState('inbound', 'No communication mirrored yet.', null)).toBe('done');
  });

  it('treats outbound-last conversations as Waiting', () => {
    expect(conversationWorkState('outbound', 'See you Friday.', '2026-09-13T13:01:00Z')).toBe('waiting');
  });

  it('does not turn unknown direction into staff work', () => {
    expect(conversationWorkState(null, 'Message imported', '2026-09-13T13:01:00Z')).toBe('done');
  });
});
