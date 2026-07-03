// Regression harness for the outreach-coach cadence engine.
//
// Each test below encodes a REAL observed failure as the target behavior. The
// "TARGET" tests FAIL today (red) — the engine is metadata-only and can't tell a
// closer from a question — and go GREEN as the consolidation phases land. The
// "GUARD" tests pass today and MUST KEEP passing (they stop the fix from
// over-correcting: real questions must still surface, fresh cold leads must still
// nudge). Run: `cd conversation-cache-worker && node --test`.
//
// Cases are grounded in real contacts (2026-06-17): Wendy/Roger Reinitz,
// Strong Friends Gym, Kwanua/PowerPlay, Abraham Williams / Taylor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRow, classify } from '../src/cadence.js';

const DAY = 86_400_000;
const ago = (d) => Date.now() - d * DAY;
const verdict = (touches, name = 'Test', extra = {}) =>
  classify({ ...buildRow('c1', name, touches), ...extra });

// ───────────────────────── TARGETS (red until fixed) ─────────────────────────

test('TARGET Wendy: a courtesy closer ("Likewise, thanks!") is not an urgent reply', () => {
  // We sent the link; she replied with a sign-off. Today: droppedReplies=1 ->
  // reply-waiting / "respond now" / priority ~129. It should be HER court.
  const v = verdict([
    { ts: ago(0.7), kind: 'sms', dir: 'out', text: 'https://www.amarimethod.com/book/initial-in-person' },
    { ts: ago(0.6), kind: 'sms', dir: 'in',  text: 'Likewise, thanks!' },
  ], 'Wendy');
  assert.notEqual(v.state, 'reply-waiting', 'a "thanks!" sign-off must not be "respond now"');
  assert.equal(v.due, false, 'nothing is owed — ball is in her court');
});

test('TARGET Strong Friends: a gym autoresponder ("how can we help?") is not an urgent human reply', () => {
  // Bot auto-reply to our missed call — NOT a person waiting on us. Text-awareness
  // must not naively promote it (it matches a question pattern).
  const v = verdict([
    { ts: ago(14.0), kind: 'call', dir: 'out' },
    { ts: ago(13.9), kind: 'sms',  dir: 'in', text: 'Hi, this is Strong Friends Gym! We saw we missed a call from you, how can we help?' },
  ], 'Strong Friends Gym');
  assert.notEqual(v.state, 'reply-waiting', 'an autoresponder must not top the worklist as a reply');
});

test('TARGET Kwanua: the REAL soft-close ("Thanks, Dr. Garrett! We\'ll be in touch.") is not urgent', () => {
  // Real pulled text (8 words) — my earlier 6-word fixture passed while reality failed.
  const v = verdict([
    { ts: ago(13.2), kind: 'call', dir: 'in' },
    { ts: ago(13.1), kind: 'sms',  dir: 'out', text: "Great talking! https://www.amarimethod.com/partner-session" },
    { ts: ago(12.9), kind: 'sms',  dir: 'in',  text: "Thanks, Dr. Garrett! We'll be in touch." },
  ], 'Kwanua Robinson');
  assert.notEqual(v.state, 'reply-waiting', '"we\'ll be in touch" is their court, not respond-now');
});

test('TARGET Anton: a longer real sign-off ("...Glad you connected. Good luck!") is not urgent', () => {
  const v = verdict([
    { ts: ago(2.1), kind: 'sms', dir: 'out', text: 'Following up!' },
    { ts: ago(2.0), kind: 'sms', dir: 'in',  text: 'Sorry, just seeing this. Glad you connected. Good luck!' },
  ], 'Anton Stryhas');
  assert.notEqual(v.state, 'reply-waiting', 'a polite sign-off, even a longer one, is not respond-now');
});

test('GUARD: an inbound CALL with no text is NOT suppressed (they called us back — surface it)', () => {
  // Real case (Andrea/Dan): we reached out, they called back, no text body. Empty
  // text must default to KEEP, never read as a "closer" — or we silence a live lead.
  const v = verdict([
    { ts: ago(1.2), kind: 'sms',  dir: 'out', text: 'Hi, following up!' },
    { ts: ago(1.0), kind: 'call', dir: 'in' },
  ], 'Called Us Back');
  assert.equal(v.state, 'reply-waiting', 'an unreturned inbound call must surface');
  assert.equal(v.due, true);
});

test('TARGET Abraham/Taylor: a 77-day-old single cold call should be parked, not "send step 2"', () => {
  const v = verdict([
    { ts: ago(77), kind: 'call', dir: 'out' }, // one cold dial, never connected, never replied
  ], 'Abraham Williams');
  assert.equal(v.due, false, 'an ancient one-touch cold call should exhaust/park, not stay due forever');
});

// ── has_pt_on_staff suppression at the PIPELINE layer (grading report line 134) ──
// The app parks PT-on-staff contacts (finalizePlay), but the coach pipeline kept spending
// a due slot + a card on them because cadence never read the field (Richard Hsu). Suppress
// here too — matching EXACTLY "Yes" (spec §1: "No"/"Unknown" are JS-truthy, must not park).

test('a has_pt_on_staff=Yes contact is parked, not due (pipeline-side suppress)', () => {
  const v = verdict([{ ts: ago(6), kind: 'sms', dir: 'out', text: 'hi' }], 'Richard Hsu', { hasPtOnStaff: 'Yes' });
  assert.equal(v.due, false, 'a trainer with a PT on staff is parked for a future campaign');
});

test('has_pt_on_staff=No / Unknown / null do NOT park (only exact "Yes" suppresses)', () => {
  for (const val of ['No', 'Unknown', null, undefined, '']) {
    const v = verdict([{ ts: ago(6), kind: 'sms', dir: 'out', text: 'hi' }], 'Normal', { hasPtOnStaff: val });
    assert.equal(v.due, true, `hasPtOnStaff=${JSON.stringify(val)} must stay due`);
  }
});

// ───────────────────────── GUARDS (green now, keep green) ────────────────────

test('GUARD: a real unanswered question IS reply-waiting (do not over-suppress)', () => {
  const v = verdict([
    { ts: ago(1.1), kind: 'sms', dir: 'out', text: 'Want me to send the link?' },
    { ts: ago(1.0), kind: 'sms', dir: 'in',  text: 'What times do you have available next week?' },
  ], 'Real Question');
  assert.equal(v.state, 'reply-waiting', 'a genuine question must still surface as respond-now');
  assert.equal(v.due, true);
});

test('GUARD: a 5-day-old cold one-touch is still due for a nudge (do not over-park)', () => {
  const v = verdict([
    { ts: ago(5), kind: 'call', dir: 'out' }, // a dial-and-miss (no duration) → invisible to them
  ], 'Fresh Cold Lead');
  assert.equal(v.due, true, 'a recent cold one-touch must still nudge, not over-park');
});

test('GUARD: a contact set aside in the app (partner_stage=dropped) stays out', () => {
  const v = verdict([
    { ts: ago(2), kind: 'sms', dir: 'in', text: 'not interested' },
  ], 'Set Aside', { partnerStage: 'dropped' });
  assert.equal(v.due, false, 'a human "not a fit" must stick');
});

// I2 — phantom reply: an unsolicited, contentless inbound (a missed call) from a
// number we never reached out to is NOT a dropped reply. (415)-numbers/JELLY BORDEN.
test('TARGET phantom-inbound: a contentless inbound CALL with zero outbound is not a dropped reply', () => {
  const row = buildRow('c1', '(415) 358-1861', [
    { ts: ago(43), kind: 'call', dir: 'in', text: '' }, // they called once, no transcript, we never reached out
  ]);
  assert.equal(row.droppedReplies, 0, 'an unsolicited contentless inbound call must not count as a reply');
});

test('GUARD: a contentful inbound with zero outbound (a real new lead texting in) STILL counts', () => {
  const row = buildRow('c1', 'New Lead', [
    { ts: ago(0.5), kind: 'sms', dir: 'in', text: 'Hi! I saw your post, I am interested in a session.' },
  ]);
  assert.equal(row.droppedReplies, 1, 'a real inbound lead with content must still surface');
});

test('GUARD: a contentless inbound CALL inside an active thread (prior outbound) STILL counts', () => {
  const row = buildRow('c1', 'Active Thread', [
    { ts: ago(2), kind: 'sms',  dir: 'out', text: 'Following up — want me to send the link?' },
    { ts: ago(1), kind: 'call', dir: 'in',  text: '' }, // they called back, worth returning
  ]);
  assert.equal(row.droppedReplies, 1, 'a callback inside an active thread is still a reply worth returning');
});

// ── Invisible calls (Eben 2026-06-19): a no-answer/no-voicemail call leaves zero memory,
// so it must NOT advance the "follow-up" sequence — but it counts toward a give-up cap so
// we don't dial a dead number forever. (No call duration on record = assume they didn't pick up.)

test('invisible call: a single dead call is a FRESH first touch, not a "follow-up text"', () => {
  // One outbound call, no duration (rang out, no VM). To them, we never made contact.
  const v = verdict([{ ts: ago(5), kind: 'call', dir: 'out' }], 'Dead Call Once');
  assert.equal(v.step, 1, 'a dead call must not advance the sequence to step 2');
  assert.equal(v.channel, 'call', 'still cold step 1 (a fresh call), not a follow-up text');
});

test('invisible call: a LANDED call (a voicemail, dur >= 15s) DOES advance the sequence', () => {
  const v = verdict([{ ts: ago(5), kind: 'call', dir: 'out', dur: 30 }], 'Left a VM');
  assert.equal(v.step, 2, 'a voicemail landed, so the next touch is step 2');
  assert.equal(v.channel, 'text', 'cold step 2 is the follow-up text');
});

test('give-up cap: 3 dead calls, never reached → stop calling, switch to a text', () => {
  const v = verdict([
    { ts: ago(8), kind: 'call', dir: 'out' },
    { ts: ago(5), kind: 'call', dir: 'out' },
    { ts: ago(3), kind: 'call', dir: 'out' },
  ], 'Never Answers');
  assert.equal(v.state, 'call-exhausted', 'after 3 dead calls we stop dialing');
  assert.equal(v.channel, 'text', 'switch to a text instead of a 4th call');
});

// ── channel shape must respect the line type + email availability (grading report §3) ──
// channelForStep was line-type-blind, so a "text" step surfaced on a landline/VoIP
// switchboard (Garrett can't SMS it) and a step-4 "email" fired even with no email on file
// (Rory Marlow, Joe Wilson — an impossible step).

test('a text step on a landline becomes a call (a switchboard cannot receive SMS)', () => {
  const v = verdict([{ ts: ago(6), kind: 'sms', dir: 'out', text: 'hi' }], 'Landline Co', { lineType: 'landline' });
  assert.equal(v.step, 2, 'cold step 2 (text step) after one landed touch');
  assert.equal(v.channel, 'call', 'landline text step is corrected to a call');
});

test('a text step on a mobile stays a text (do not over-correct textable lines)', () => {
  const v = verdict([{ ts: ago(6), kind: 'sms', dir: 'out', text: 'hi' }], 'Mobile Person', { lineType: 'mobile' });
  assert.equal(v.channel, 'text');
});

test('an email step with NO email on file falls back to a textable channel (impossible step guard)', () => {
  // 3 landed touches → cold step 4 = email. No email + mobile line → text, not a dead email step.
  const three = [
    { ts: ago(20), kind: 'sms', dir: 'out', text: 'one' },
    { ts: ago(13), kind: 'sms', dir: 'out', text: 'two' },
    { ts: ago(6),  kind: 'sms', dir: 'out', text: 'three' },
  ];
  const v = verdict(three, 'No Email', { lineType: 'mobile', hasEmail: false });
  assert.equal(v.step, 4, 'cold step 4 is the email step');
  assert.notEqual(v.channel, 'email', 'no email on file → not an email step');
  assert.equal(v.channel, 'text', 'textable line → fall back to text');
});

test('an email step with NO email on a landline falls back to a call', () => {
  const three = [
    { ts: ago(20), kind: 'sms', dir: 'out', text: 'one' },
    { ts: ago(13), kind: 'sms', dir: 'out', text: 'two' },
    { ts: ago(6),  kind: 'sms', dir: 'out', text: 'three' },
  ];
  const v = verdict(three, 'No Email Landline', { lineType: 'landline', hasEmail: false });
  assert.equal(v.channel, 'call');
});

test('an email step WITH an email on file stays an email (even on a landline — email needs no phone)', () => {
  const three = [
    { ts: ago(20), kind: 'sms', dir: 'out', text: 'one' },
    { ts: ago(13), kind: 'sms', dir: 'out', text: 'two' },
    { ts: ago(6),  kind: 'sms', dir: 'out', text: 'three' },
  ];
  const v = verdict(three, 'Has Email', { lineType: 'landline', hasEmail: true });
  assert.equal(v.channel, 'email');
});

test('give-up cap: a warm contact (they talked) is never call-exhausted', () => {
  const v = verdict([
    { ts: ago(20), kind: 'call', dir: 'out', dur: 130 }, // a real talk → warm
    { ts: ago(8),  kind: 'call', dir: 'out' },
    { ts: ago(5),  kind: 'call', dir: 'out' },
    { ts: ago(3),  kind: 'call', dir: 'out' },
  ], 'Talked Then Dialed');
  assert.notEqual(v.state, 'call-exhausted', 'a contact who engaged is never auto-given-up by the call cap');
});
