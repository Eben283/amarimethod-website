import { describe, it, expect } from 'vitest';
import { buildCard, isNonReply } from './build-card.js';

const NOW = Date.parse('2026-06-21T12:00:00Z');
const msg = (over) => ({ direction: 'outbound', type: 'SMS', body: '', callDuration: null, date: null, ...over });

describe('buildCard — one true view, no contradictions', () => {
  // JACK COONEY — real data. Every message outbound; the only "talk" was an April
  // call, then June was voicemails + a no-answer; he NEVER replied. VoIP, owner.
  it('Jack: cold (never reached back, recent attempts all failed), call (VoIP), pitch (named owner)', () => {
    const c = buildCard({
      firstName: 'Jack', lastName: 'Cooney', role: 'Owner', business: 'Accelerate Sports Performance', lineType: 'voip',
      thread: [
        msg({ type: 'CALL', callDuration: 136, date: '2026-04-01T00:39:00Z' }),
        msg({ type: 'CALL', callDuration: 268, date: '2026-04-21T23:18:00Z' }),
        msg({ type: 'SMS', body: 'Hi Jack, Garrett again. Would love to connect.', date: '2026-06-17T23:34:00Z' }),
        msg({ type: 'SMS', body: 'Hey Jack, just left you a voicemail, give me a call back.', date: '2026-06-17T23:35:00Z' }),
        msg({ type: 'CALL', callDuration: null, date: '2026-06-21T00:01:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('cold');           // NOT "warm reconnect"
    expect(c.engaged).toBe(false);
    expect(c.channel).toBe('call');         // VoIP
    expect(c.play).toBe('pitch');           // named owner
    expect(c.why).toMatch(/^Call Jack again, no response yet/);
    expect(c.why).not.toMatch(/reconnect|engaged|replied|spoke/i);
  });

  // RAMY — real data. A 169s (real) call YESTERDAY, landline, owner. No inbound,
  // but a recent connect → "talked, follow up", and call (not text).
  it('Ramy: talked (recent 169s call), call (landline), pitch (owner)', () => {
    const c = buildCard({
      firstName: 'Ramy', lastName: '', role: 'Owner', business: 'Sunset Gym', lineType: 'landline',
      thread: [
        msg({ type: 'CALL', callDuration: null, date: '2026-05-29T00:08:00Z' }),
        msg({ type: 'CALL', callDuration: 169, date: '2026-06-20T23:54:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('talked');
    expect(c.channel).toBe('call');         // landline, never "text"
    expect(c.play).toBe('pitch');
    expect(c.why).toMatch(/Call Ramy back, you spoke yesterday/);
  });

  it('engaged: a real inbound text reply → warm, pick up the thread', () => {
    const c = buildCard({
      firstName: 'Sara', lastName: 'Doell', role: 'Trainer', lineType: 'mobile',
      thread: [
        msg({ type: 'SMS', body: 'Garrett here, would love to gift you a session', date: '2026-06-10T10:00:00Z' }),
        msg({ direction: 'inbound', type: 'SMS', body: 'Oh interesting, how long is a session?', date: '2026-06-18T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('engaged');
    expect(c.engaged).toBe(true);
    expect(c.channel).toBe('text');
    expect(c.why).toMatch(/Text Sara back, they replied/);
  });

  it('an OTP / automated inbound does NOT count as engagement (this was the Jack-style bug)', () => {
    const c = buildCard({
      firstName: 'Pat', lastName: 'Jones', role: 'Trainer', lineType: 'mobile',
      thread: [
        msg({ type: 'SMS', body: 'Garrett here', date: '2026-06-10T10:00:00Z' }),
        msg({ direction: 'inbound', type: 'SMS', body: '583921 is your verification code.', date: '2026-06-12T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('cold');           // the code is not a reply
    expect(c.engaged).toBe(false);
  });

  it('facility with no named owner → discovery (call and find the person)', () => {
    const c = buildCard({
      fullName: 'Punch King Fitness', role: 'Owner', lineType: 'landline',
      thread: [msg({ type: 'CALL', callDuration: null, date: '2026-06-01T10:00:00Z' })],
    }, NOW);
    expect(c.play).toBe('discovery');
    expect(c.why).toMatch(/^Call and ask who handles partnerships/);
  });

  it('channel is line-type, full stop: a mobile owner is textable, a landline owner is not', () => {
    const base = { firstName: 'Mike', lastName: 'Lee', role: 'Owner', thread: [] };
    expect(buildCard({ ...base, lineType: 'mobile' }, NOW).channel).toBe('text');
    expect(buildCard({ ...base, lineType: 'landline' }, NOW).channel).toBe('call');
    expect(buildCard({ ...base, lineType: 'voip' }, NOW).channel).toBe('call');
  });
});

describe('isNonReply guard (engagement uses it)', () => {
  it('drops codes, artifacts, closers; keeps real replies', () => {
    expect(isNonReply('583921 is your verification code.')).toBe(true);
    expect(isNonReply('##- Please type your reply above this line -##')).toBe(true);
    expect(isNonReply('Im good.')).toBe(true);
    expect(isNonReply('Yes, what times do you have?')).toBe(false);
  });
});
