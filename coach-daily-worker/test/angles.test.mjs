// Unit tests for the cold-path angle ladder.
// Run: `cd coach-daily-worker && npm test`.
//
// The ladder's job: each of the 5 cold-sequence touches carries a genuinely
// different angle (what NEW thing this touch says), rendered per channel. See
// ops/drafts/fable-5-review-2026-07-01.md and ops/ref/correct-followup-card.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLD_RUNGS, getRung, renderAngle, renderGuaranteeFallback } from '../src/angles.js';

const ctx = (overrides = {}) => ({ name: 'Alex Rivera', days: 5, product: null, overlay: null, ...overrides });

test('getRung returns null for warm variant — warm ladder is out of scope', () => {
  assert.equal(getRung('warm', 1), null);
});

test('getRung returns null for an out-of-range step', () => {
  assert.equal(getRung('cold', 0), null);
  assert.equal(getRung('cold', 6), null);
});

test('COLD_RUNGS has exactly 5 steps matching the cadence engine sequence', () => {
  assert.equal(COLD_RUNGS.length, 5);
  assert.deepEqual(COLD_RUNGS.map((r) => r.channel), ['call', 'text', 'call', 'email', 'text']);
  assert.deepEqual(COLD_RUNGS.map((r) => r.step), [1, 2, 3, 4, 5]);
});

test('every rung has a distinct angle id and a non-empty angleLabel', () => {
  const ids = COLD_RUNGS.map((r) => r.angle);
  assert.equal(new Set(ids).size, ids.length, 'angle ids must be unique — that is the whole point of a ladder');
  for (const r of COLD_RUNGS) assert.ok(r.angleLabel && r.angleLabel.length > 0);
});

test('step 1 (identity, call) renders a callScript and nothing else', () => {
  const out = renderAngle('cold', 1, ctx());
  assert.equal(out.angle, 'identity');
  assert.equal(out.channel, 'call');
  assert.ok(Array.isArray(out.callScript) && out.callScript.length > 0);
  assert.equal(out.sms, null);
  assert.equal(out.email, null);
});

test('step 1 does not promise a text to an untextable contact — step 2 is also a call for them, so that promise would be false', () => {
  const textable = renderAngle('cold', 1, ctx({ untextable: false }));
  const untextable = renderAngle('cold', 1, ctx({ untextable: true }));
  assert.match(textable.callScript.join(' ').toLowerCase(), /text/);
  assert.doesNotMatch(untextable.callScript.join(' ').toLowerCase(), /\btext\b/);
});

test('step 2 (gift, text) renders sms, and no email', () => {
  const out = renderAngle('cold', 2, ctx());
  assert.equal(out.angle, 'gift');
  assert.equal(out.channel, 'text');
  assert.ok(Array.isArray(out.sms) && out.sms.length > 0);
  assert.equal(out.email, null);
});

test('step 2 (gift, default/no overlay) also provides a purpose-written callScript for when an untextable number forces this rung onto a call — it must not just be the sms text relabeled, since the sms text references texting itself ("feel free to call or text"), which is nonsensical read aloud on a live call', () => {
  const out = renderAngle('cold', 2, ctx());
  assert.ok(Array.isArray(out.callScript) && out.callScript.length > 0);
  assert.notDeepEqual(out.callScript, out.sms, 'callScript must be distinct content, not the sms array reused verbatim');
  const callText = out.callScript.join(' ').toLowerCase();
  assert.ok(!callText.includes('call or text'), 'a script meant to be read aloud on a call must not tell the listener to "call or text"');
});

test('step 3 (honest-why, call) names the barter lightly, never pitches partnership mechanics', () => {
  const out = renderAngle('cold', 3, ctx());
  assert.equal(out.angle, 'honest-why');
  assert.equal(out.channel, 'call');
  const text = out.callScript.join(' ').toLowerCase();
  assert.ok(text.includes('partner'), 'must name the barter (partnering with trainers/gyms)');
  assert.ok(!/\b\d+%|referral fee|commission|income\b/.test(text), 'must not pitch partnership mechanics/numbers in this touch');
});

test('step 3 does not ask to text an untextable contact — "can I text you" is a promise that number can never fulfill', () => {
  const textable = renderAngle('cold', 3, ctx({ untextable: false }));
  const untextable = renderAngle('cold', 3, ctx({ untextable: true }));
  assert.match(textable.callScript.join(' ').toLowerCase(), /text you/);
  assert.doesNotMatch(untextable.callScript.join(' ').toLowerCase(), /text you/);
});

test('step 4 (substance, email) renders a subject and body, and states the full guarantee', () => {
  const out = renderAngle('cold', 4, ctx());
  assert.equal(out.angle, 'substance');
  assert.equal(out.channel, 'email');
  assert.equal(out.sms, null);
  assert.equal(out.callScript, null);
  assert.ok(out.email && out.email.subject && out.email.body);
  assert.notEqual(out.email.subject, 'A note from Garrett', 'must not carry forward the old generic hardcoded subject');
  assert.match(out.email.body, /no extra charge|no charge/i, 'the guarantee must actually be stated');
});

test('step 4 references the specific stalled product when a link-stall overlay is active', () => {
  const out = renderAngle('cold', 4, ctx({ overlay: 'link-stall', product: '4-Session Series' }));
  assert.match(out.email.subject + out.email.body, /4-Session Series/);
});

test('step 5 (gentle-no, text) is a real breakup — door open, no guilt, no re-pitch', () => {
  const out = renderAngle('cold', 5, ctx());
  assert.equal(out.angle, 'gentle-no');
  assert.equal(out.channel, 'text');
  const text = out.sms.join(' ').toLowerCase();
  assert.ok(!text.includes('gift'), 'the breakup must not re-pitch the earlier gift offer');
});

test('overlay swaps content, never step or channel', () => {
  const plain = renderAngle('cold', 2, ctx());
  const overlaid = renderAngle('cold', 2, ctx({ overlay: 'link-stall', product: '4-Session Series' }));
  assert.equal(plain.step, overlaid.step);
  assert.equal(plain.channel, overlaid.channel);
  assert.notDeepEqual(plain.sms, overlaid.sms);
  assert.match(overlaid.sms.join(' '), /4-Session Series/);
});

test('the overlay text never asks "worth a quick call?" — that string becomes a call script for untextable link-stall contacts (via the untextable fallback in template.js), and is nonsensical read aloud on a call already in progress', () => {
  const overlaid = renderAngle('cold', 2, ctx({ overlay: 'link-stall', product: '4-Session Series' }));
  assert.doesNotMatch(overlaid.sms.join(' ').toLowerCase(), /worth a quick call/);
  const fallback = renderGuaranteeFallback(ctx({ product: '4-Session Series' }));
  assert.doesNotMatch(fallback.join(' ').toLowerCase(), /worth a quick call/);
});

test('no rung asserts a call outcome it cannot verify ("didn\'t catch you", "no connect")', () => {
  for (const r of COLD_RUNGS) {
    const out = renderAngle('cold', r.step, ctx({ days: 20 }));
    const text = [...(out.sms || []), ...(out.callScript || []), out.email?.body || ''].join(' ').toLowerCase();
    assert.ok(!text.includes("didn't catch you"), `step ${r.step} must not assert an unverifiable call outcome`);
    assert.ok(!text.includes("didn't get to connect"), `step ${r.step} must not assert an unverifiable call outcome`);
  }
});

test('no rung uses Dr./doctor/chiropractor framing (active legal restriction)', () => {
  for (const r of COLD_RUNGS) {
    const out = renderAngle('cold', r.step, ctx());
    const text = [...(out.sms || []), ...(out.callScript || []), out.email?.subject || '', out.email?.body || ''].join(' ');
    assert.ok(!/\bDr\.|chiropractor/i.test(text), `step ${r.step} must not use Dr./chiropractor framing`);
  }
});

test('business contact (gym/studio name) gets business-flavored copy at every step', () => {
  const bizCtx = ctx({ name: 'Strong Friends Gym' });
  for (const r of COLD_RUNGS) {
    const out = renderAngle('cold', r.step, bizCtx);
    const text = [...(out.sms || []), ...(out.callScript || []), out.email?.body || ''].join(' ').toLowerCase();
    assert.ok(text.includes('trainer') || text.includes('gym') || text.includes('team'), `step ${r.step} should read as addressed to a business contact`);
  }
});
