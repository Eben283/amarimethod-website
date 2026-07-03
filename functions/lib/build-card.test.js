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

  // TOM REZENDES — real data shape: a 146s (real) connected call on 6/6, then texted by
  // name. By grading day the call is >14d old, so the STATE is cold (recency gate), but the
  // PLAY must still be a pitch — we already talked to him, we know who to reach. The 14-day
  // talked window gates the headline, it must not erase engagement from the play decision.
  it('Tom: an old (>14d) real connected call keeps the PLAY a pitch even after state falls to cold', () => {
    const c = buildCard({
      firstName: 'Tom', lastName: 'Rezendes', role: 'Trainer', lineType: 'landline',
      thread: [
        msg({ type: 'CALL', callDuration: 146, date: '2026-05-20T18:00:00Z' }), // ~32d before NOW
        msg({ type: 'SMS', body: 'Great talking Tom, here is the link', date: '2026-05-21T18:00:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('cold');           // the connect is older than 14d
    expect(c.play).toBe('pitch');           // but we already know who to reach — not discovery
    expect(c.why).not.toMatch(/who handles partnerships/);
  });

  it('a cold facility with only dead calls (no connect, no reply) is still discovery', () => {
    // Guard: everEngaged must require a REAL connect/reply, not just any call attempt.
    const c = buildCard({
      fullName: 'Iron House Gym', role: 'Owner', lineType: 'landline',
      thread: [
        msg({ type: 'CALL', callDuration: 20, date: '2026-06-01T18:00:00Z' }), // short = no connect
        msg({ type: 'CALL', callDuration: null, date: '2026-06-10T18:00:00Z' }),
      ],
    }, NOW);
    expect(c.play).toBe('discovery');
  });

  it('channel is line-type, full stop: a mobile owner is textable, a landline owner is not', () => {
    const base = { firstName: 'Mike', lastName: 'Lee', role: 'Owner', thread: [] };
    expect(buildCard({ ...base, lineType: 'mobile' }, NOW).channel).toBe('text');
    expect(buildCard({ ...base, lineType: 'landline' }, NOW).channel).toBe('call');
    expect(buildCard({ ...base, lineType: 'voip' }, NOW).channel).toBe('call');
  });
});

// ── phone provenance (2026-07-02: Garrett dialed a wrong number off a confident CALL
// card for a LinkedIn import whose phone was unverified CSV research) ─────────────────
// A placeholder email (*@amari-prospect.placeholder) or a LinkedIn source means the
// number on file is import research, NOT a confirmed line. Until it's verified
// (outreach_verified / trainer-solo / dm-verified) or PROVEN by engagement on that
// number (an inbound text/call, or a 120s+ connected call), the card must never say
// call or text — the card becomes a verify-first task, and the facts carry the honesty footnote.
describe('buildCard — phone provenance (never trust an unverified import number)', () => {
  // OXANA — the wrong-number incident shape: LinkedIn import, placeholder email,
  // no verification tags, no engagement. Previously yielded a confident CALL card.
  it('Oxana: placeholder email + no verification + no engagement → verify-first task, never dial the number', () => {
    const c = buildCard({
      firstName: 'Oxana', lastName: 'Petrova', role: 'Trainer', lineType: 'voip',
      email: 'oxana.petrova.linkedin@amari-prospect.placeholder',
      thread: [],
    }, NOW);
    expect(c.play).toBe('discovery');       // verify-first, not a pitch on the number
    expect(c.why).toMatch(/verify/i);
    expect(c.why).not.toMatch(/^Call /);    // headline never invites dialing the number
    expect(c.facts.phoneProvenance).toBe('unverified');
    expect(c.facts.phoneNote).toMatch(/phone unverified/i);
  });

  it('Oxana on a mobile-typed line is STILL not textable (the number itself is the research)', () => {
    const c = buildCard({
      firstName: 'Oxana', lastName: 'Petrova', role: 'Trainer', lineType: 'mobile',
      email: 'oxana.petrova.linkedin@amari-prospect.placeholder',
      thread: [],
    }, NOW);
    expect(c.play).toBe('discovery');
    expect(c.why).not.toMatch(/^Text /);
  });

  it('a LinkedIn source signal flags the phone even with a real-looking email', () => {
    const c = buildCard({
      firstName: 'Lena', lastName: 'Ma', role: 'Trainer', lineType: 'mobile',
      email: 'lena@realgym.com', source: 'LinkedIn import',
      thread: [],
    }, NOW);
    expect(c.play).toBe('discovery');
    expect(c.facts.phoneProvenance).toBe('unverified');
  });

  it('a normal contact (no import signal) is untouched: on-file provenance, no note', () => {
    const c = buildCard({
      firstName: 'Mike', lastName: 'Lee', role: 'Owner', lineType: 'mobile',
      email: 'mike@sfgym.com',
      thread: [],
    }, NOW);
    expect(c.channel).toBe('text');
    expect(c.facts.phoneProvenance).toBe('on-file');
    expect(c.facts.phoneNote).toBe(null);
  });

  // ── verification overrides (spec §2: outreach_verified / trainer-solo / dm-verified) ──
  // HAROLD STEWART — real data. Placeholder email, ZERO replies, but dm-verified:
  // a discovery call confirmed him, so the number is trusted even with no engagement.
  it('Harold: dm-verified overrides the placeholder (verified beats unverified)', () => {
    const c = buildCard({
      firstName: 'Harold', lastName: 'Stewart', role: 'Trainer', lineType: 'mobile',
      email: 'harold.stewart.linkedin@amari-prospect.placeholder', dmVerified: true,
      thread: [
        msg({ type: 'SMS', body: 'Hi Harold, Garrett here.', date: '2026-06-10T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.channel).toBe('text');
    expect(c.facts.phoneProvenance).toBe('verified');
    expect(c.why).not.toMatch(/LinkedIn/);
  });

  it('outreach_verified flag overrides the placeholder', () => {
    const c = buildCard({
      firstName: 'Ana', lastName: 'Cruz', role: 'Owner', lineType: 'voip',
      email: 'ana.cruz.linkedin@amari-prospect.placeholder', outreachVerified: true,
      thread: [],
    }, NOW);
    expect(c.channel).toBe('call');
    expect(c.facts.phoneProvenance).toBe('verified');
  });

  it('trainer-solo (isSolo) overrides the placeholder', () => {
    const c = buildCard({
      firstName: 'Ben', lastName: 'Ito', role: 'Trainer', lineType: 'mobile',
      email: 'ben.ito.linkedin@amari-prospect.placeholder', isSolo: true,
      thread: [],
    }, NOW);
    expect(c.channel).toBe('text');
    expect(c.facts.phoneProvenance).toBe('verified');
  });

  // ── engagement proves the number (decided explicitly: a reply or a real talk ON
  //    that number is de-facto verification — it demonstrably reaches them) ──
  // TJ — real data shape: placeholder email, but he REPLIED by text. The number works.
  it('TJ: an inbound SMS reply proves the number → text him, provenance proven', () => {
    const c = buildCard({
      firstName: 'TJ', lastName: '', role: 'Trainer', lineType: 'mobile',
      email: 'tj.linkedin@amari-prospect.placeholder',
      thread: [
        msg({ type: 'SMS', body: 'Hi TJ, Garrett here.', date: '2026-06-10T10:00:00Z' }),
        msg({ direction: 'inbound', type: 'SMS', body: 'Sure, tell me more about it', date: '2026-06-12T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('engaged');
    expect(c.channel).toBe('text');
    expect(c.facts.phoneProvenance).toBe('proven');
  });

  // MATT SOZA — real data shape: placeholder email, but a 150s+ connected call.
  it('Matt Soza: a 120s+ connected call proves the number', () => {
    const c = buildCard({
      firstName: 'Matt', lastName: 'Soza', role: 'Owner', lineType: 'mobile',
      email: 'matt.soza.linkedin@amari-prospect.placeholder',
      thread: [
        msg({ type: 'CALL', callDuration: 154, date: '2026-06-19T18:00:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('talked');
    expect(c.channel).toBe('text');
    expect(c.facts.phoneProvenance).toBe('proven');
  });

  // DEVON BERRY — real data shape: placeholder email, but an inbound call from the number.
  it('Devon Berry: an inbound call proves the number', () => {
    const c = buildCard({
      firstName: 'Devon', lastName: 'Berry', role: 'Staff', lineType: 'mobile',
      email: 'devon.berry.linkedin@amari-prospect.placeholder',
      thread: [
        msg({ type: 'CALL', callDuration: null, date: '2026-06-01T18:00:00Z' }),
        msg({ direction: 'inbound', type: 'CALL', callDuration: 45, date: '2026-06-02T18:00:00Z' }),
      ],
    }, NOW);
    expect(c.facts.phoneProvenance).toBe('proven');
    expect(c.channel).toBe('text');
  });

  // TARA VOOGT — real data shape: placeholder email, but she replied by text.
  it('Tara Voogt: engagement upgrades trust in the number', () => {
    const c = buildCard({
      firstName: 'Tara', lastName: 'Voogt', role: 'Director', lineType: 'mobile',
      email: 'tara.voogt.linkedin@amari-prospect.placeholder',
      thread: [
        msg({ type: 'SMS', body: 'Hi Tara, Garrett here.', date: '2026-06-10T10:00:00Z' }),
        msg({ direction: 'inbound', type: 'SMS', body: 'Thanks for reaching out, what does a session involve?', date: '2026-06-14T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('engaged');
    expect(c.channel).toBe('text');
    expect(c.facts.phoneProvenance).toBe('proven');
  });

  // ── things that must NOT prove the number ──
  it('a short outbound call (ring time / brief voicemail) does NOT prove the number', () => {
    const c = buildCard({
      firstName: 'Kim', lastName: 'Ray', role: 'Trainer', lineType: 'mobile',
      email: 'kim.ray.linkedin@amari-prospect.placeholder',
      thread: [
        msg({ type: 'CALL', callDuration: 30, date: '2026-06-18T18:00:00Z' }),
      ],
    }, NOW);
    expect(c.facts.phoneProvenance).toBe('unverified');
    expect(c.play).toBe('discovery');
  });

  it('an EMAIL reply proves engagement but NOT the phone (reply by email, number still unverified)', () => {
    const c = buildCard({
      firstName: 'Nadia', lastName: 'Kim', role: 'Trainer', lineType: 'mobile',
      email: 'nadia.kim.linkedin@amari-prospect.placeholder',
      thread: [
        msg({ type: 'EMAIL', body: 'Hi Nadia, Garrett here.', date: '2026-06-10T10:00:00Z' }),
        msg({ direction: 'inbound', type: 'EMAIL', body: 'Interesting, can you send more details?', date: '2026-06-12T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.state).toBe('engaged');
    expect(c.play).toBe('discovery');
    expect(c.facts.phoneProvenance).toBe('unverified');
    expect(c.facts.phoneNote).toMatch(/phone unverified/i);
    expect(c.why).not.toMatch(/^(Call|Text) /);
  });

  // ── enrichment-URL-only imports (grading-pass gap, 2026-07-03) ──
  // Some LinkedIn-sourced contacts carry a REAL-looking email and an empty source —
  // their only LinkedIn signal is the enrichment URL (partner_linkedin_url, backfilled
  // by ops/scripts/backfill-partner-linkedin-urls.mjs). Their phone still came from
  // import research, so a URL with no verified/proven signal must become a verify-first task
  // exactly like the placeholder-email shape.
  it.each([
    ['Dante', 'Jeavon', 'dante@jeavonfitness.com', 'https://www.linkedin.com/in/dante-jeavon'],
    ['James', 'Fish', 'james.fish@gmail.com', 'https://linkedin.com/in/james-fish-sf'],
    ['Rich', 'Yokota', 'rich@yokotagolf.com', 'https://www.linkedin.com/in/rich-yokota'],
    ['Daivya', 'Allmond', 'daivya.allmond@outlook.com', 'https://www.linkedin.com/in/daivya-allmond'],
  ])('%s %s: LinkedIn URL + real email + no source → still unverified, verify-first task', (firstName, lastName, email, linkedinUrl) => {
    const c = buildCard({
      firstName, lastName, role: 'Trainer', lineType: 'mobile',
      email, source: null, linkedinUrl,
      thread: [
        msg({ type: 'SMS', body: `Hi ${firstName}, Garrett here.`, date: '2026-06-15T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.play).toBe('discovery');
    expect(c.facts.phoneProvenance).toBe('unverified');
    expect(c.facts.phoneNote).toMatch(/phone unverified/i);
    expect(c.why).not.toMatch(/^(Call|Text) /);
  });

  it('a LinkedIn URL does not lock out a PROVEN number (they replied on it)', () => {
    const c = buildCard({
      firstName: 'Dante', lastName: 'Jeavon', role: 'Trainer', lineType: 'mobile',
      email: 'dante@jeavonfitness.com', linkedinUrl: 'https://www.linkedin.com/in/dante-jeavon',
      thread: [
        msg({ type: 'SMS', body: 'Hi Dante, Garrett here.', date: '2026-06-10T10:00:00Z' }),
        msg({ direction: 'inbound', type: 'SMS', body: 'Hey Garrett, yes tell me more', date: '2026-06-12T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.channel).toBe('text');
    expect(c.facts.phoneProvenance).toBe('proven');
  });

  it('a LinkedIn URL does not lock out a VERIFIED contact (dm-verified beats the URL)', () => {
    const c = buildCard({
      firstName: 'Rich', lastName: 'Yokota', role: 'Owner', lineType: 'voip',
      email: 'rich@yokotagolf.com', linkedinUrl: 'https://www.linkedin.com/in/rich-yokota',
      dmVerified: true,
      thread: [],
    }, NOW);
    expect(c.channel).toBe('call');
    expect(c.facts.phoneProvenance).toBe('verified');
  });

  it('a blank/whitespace LinkedIn URL is NOT an import signal', () => {
    const c = buildCard({
      firstName: 'Mike', lastName: 'Lee', role: 'Owner', lineType: 'mobile',
      email: 'mike@sfgym.com', linkedinUrl: '  ',
      thread: [],
    }, NOW);
    expect(c.channel).toBe('text');
    expect(c.facts.phoneProvenance).toBe('on-file');
  });

  it('an OTP inbound does NOT prove the number (isNonReply still guards)', () => {
    const c = buildCard({
      firstName: 'Vic', lastName: 'Nash', role: 'Trainer', lineType: 'mobile',
      email: 'vic.nash.linkedin@amari-prospect.placeholder',
      thread: [
        msg({ direction: 'inbound', type: 'SMS', body: '583921 is your verification code.', date: '2026-06-12T10:00:00Z' }),
      ],
    }, NOW);
    expect(c.facts.phoneProvenance).toBe('unverified');
    expect(c.play).toBe('discovery');
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
