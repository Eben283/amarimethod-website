import { describe, it, expect } from 'vitest';
import { isNonReply } from './staff-conversations.js';

describe('isNonReply — keeps non-replies out of the needs-reply list', () => {
  // The 4 false positives Eben hit (all marked "no reply needed" but kept returning).
  it('drops an automated OTP / verification code', () => {
    expect(isNonReply('977001 is your Luma verification code.')).toBe(true);
    expect(isNonReply('Your code is 4821. Do not share it.')).toBe(true);
  });
  it('drops an email reply-delimiter artifact', () => {
    expect(isNonReply('##- Please type your reply above this line -##')).toBe(true);
  });
  it('drops bare closers', () => {
    expect(isNonReply('Im good.')).toBe(true);
    expect(isNonReply("I'm good")).toBe(true);
    expect(isNonReply('Likewise, thanks!')).toBe(true);
    expect(isNonReply('Thank you!')).toBe(true);
    expect(isNonReply('no thanks')).toBe(true);
  });
  it('drops an empty / whitespace body', () => {
    expect(isNonReply('')).toBe(true);
    expect(isNonReply('   ')).toBe(true);
    expect(isNonReply(null)).toBe(true);
  });

  // Real replies that MUST still surface.
  it('keeps a genuine question or interested reply', () => {
    expect(isNonReply('Yes I am interested, when can we meet?')).toBe(false);
    expect(isNonReply('Can you send me the link?')).toBe(false);
    expect(isNonReply('What time works for you?')).toBe(false);
  });
  it('keeps a message that starts like a closer but carries real content', () => {
    expect(isNonReply('Thanks, but actually I have a question about pricing')).toBe(false);
    expect(isNonReply('Thanks! Do you have evening slots?')).toBe(false);
  });
});
