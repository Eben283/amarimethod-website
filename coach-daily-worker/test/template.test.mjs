// Unit tests for template.js's per-contact record building. buildDesiredRecord
// and recordsEqual are pure (no KV access), so no mocking is needed — the
// runTemplate() orchestration around them (KV read/write/diff/delete) is
// unchanged by this refactor and isn't re-tested here.
//
// Run: `cd coach-daily-worker && npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDesiredRecord, recordsEqual, runTemplate } from '../src/template.js';

// Minimal in-memory KV — just enough to exercise runTemplate's read/write/diff
// bookkeeping without a real Cloudflare binding.
function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: async (key, type) => (type === 'json' ? (store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : null) : store.get(key) ?? null),
    put: async (key, value) => { store.set(key, JSON.parse(value)); },
    delete: async (key) => { store.delete(key); },
    _store: store,
  };
}

const dueItem = (overrides = {}) => ({
  contactId: 'c1', name: 'Alex Rivera', sinceLastTouchDays: 5, lineType: 'mobile',
  state: 'one-touch-no-reply', variant: 'cold', step: 1, totalSteps: 5, channel: 'call', isBreakup: false,
  ...overrides,
});

test('cold step 1 (identity): call channel, callScript populated, no sms/email', () => {
  const rec = buildDesiredRecord(dueItem({ step: 1 }), {});
  assert.equal(rec.channel, 'call');
  assert.equal(rec.angle, 'identity');
  assert.ok(rec.callScript && rec.callScript.length > 0);
  assert.equal(rec.sms, null);
  assert.equal(rec.email, null);
  assert.equal(rec.bucket, 'called-no-connect');
});

test('cold step 2 (gift), no stall: text channel, sms populated', () => {
  const rec = buildDesiredRecord(dueItem({ step: 2, state: 'one-touch-no-reply' }), {});
  assert.equal(rec.channel, 'text');
  assert.equal(rec.angle, 'gift');
  assert.ok(rec.sms && rec.sms.length > 0);
  assert.equal(rec.bucket, 'called-no-connect');
});

test('cold step 2 with a link-stall overlay: still text/gift, but content references the product; bucket becomes link-sent', () => {
  const rec = buildDesiredRecord(
    dueItem({ step: 2, state: 'gone-quiet' }),
    { stall: { product: '4-Session Series' } },
  );
  assert.equal(rec.channel, 'text');
  assert.equal(rec.angle, 'gift', 'overlay changes content, not the angle/step/channel');
  assert.match(rec.sms.join(' '), /4-Session Series/);
  assert.equal(rec.bucket, 'link-sent');
});

test('cold step 4 (substance): email channel regardless of line type', () => {
  const rec = buildDesiredRecord(dueItem({ step: 4, lineType: 'landline' }), {});
  assert.equal(rec.channel, 'email');
  assert.equal(rec.angle, 'substance');
  assert.ok(rec.email && rec.email.subject && rec.email.body);
  assert.equal(rec.sms, null);
  assert.equal(rec.callScript, null);
});

test('an untextable number at a text-shaped step (2) falls back to a call, not a text', () => {
  const rec = buildDesiredRecord(dueItem({ step: 2, lineType: 'landline' }), {});
  assert.equal(rec.channel, 'call');
  assert.ok(rec.callScript && rec.callScript.length > 0);
  assert.equal(rec.sms, null);
  assert.match(rec.whyNow, /landline/);
});

test('an untextable number at step 2 gets the purpose-written call script, not the sms text relabeled — the sms text tells the reader to "call or text", which is nonsensical read aloud on a live call', () => {
  const textable = buildDesiredRecord(dueItem({ step: 2, lineType: 'mobile' }), {});
  const untextable = buildDesiredRecord(dueItem({ step: 2, lineType: 'landline' }), {});
  assert.notDeepEqual(untextable.callScript, textable.sms);
  assert.ok(!untextable.callScript.join(' ').toLowerCase().includes('call or text'));
});

test('an untextable number at the email step (4) stays email — lineType only overrides text-shaped rungs', () => {
  const rec = buildDesiredRecord(dueItem({ step: 4, lineType: 'landline' }), {});
  assert.equal(rec.channel, 'email');
});

test('cold step 5 (gentle-no / breakup): text channel', () => {
  const rec = buildDesiredRecord(dueItem({ step: 5, state: 'breakup', isBreakup: true }), {});
  assert.equal(rec.channel, 'text');
  assert.equal(rec.angle, 'gentle-no');
  assert.ok(rec.sms && rec.sms.length > 0);
});

test('a price-objection flag appends a warning to whyNow without changing the rendered content', () => {
  const withoutFlag = buildDesiredRecord(dueItem({ step: 2 }), {});
  const withFlag = buildDesiredRecord(dueItem({ step: 2 }), { priceFlag: true });
  assert.deepEqual(withoutFlag.sms, withFlag.sms);
  assert.match(withFlag.whyNow, /cost or insurance/);
  assert.doesNotMatch(withoutFlag.whyNow, /cost or insurance/);
});

test('a warm-variant contact with a stalled link (the one way "gone-quiet" reaches this path today) gets the pre-ladder guarantee fallback, not a crash', () => {
  const rec = buildDesiredRecord(
    dueItem({ variant: 'warm', step: 3, state: 'gone-quiet' }),
    { stall: { product: '8-Session Series' } },
  );
  assert.equal(rec.bucket, 'link-sent');
  assert.match(rec.message, /8-Session Series/);
  assert.ok(rec.angle, 'fallback must still be labeled with an angle, not silently unlabeled');
});

test('P1 regression: a warm-variant contact at their OWN breakup step with NO stall gets no card at all, never an "undefined link" card', () => {
  // Adding "breakup" to TARGET_STATES (needed for the cold gentle-no rung)
  // also admits warm contacts at their final step with no stall present —
  // renderAngle('warm', ...) returns null and there is no product to
  // reference, so buildDesiredRecord must bail out with null rather than
  // rendering the fallback with product: undefined.
  const rec = buildDesiredRecord(
    dueItem({ variant: 'warm', step: 4, totalSteps: 4, state: 'breakup', isBreakup: true }),
    {}, // no stall
  );
  assert.equal(rec, null);
});

test('recordsEqual catches a change in angle/email/callScript alone — the staleness bug the ladder introduces if not fixed', () => {
  const a = { message: 'same', whyNow: 'same', variations: ['same'], angle: 'gift', channel: 'text', email: null, callScript: null };
  const b = { ...a, angle: 'substance', channel: 'email', email: { subject: 's', body: 'b' } };
  assert.ok(!recordsEqual(a, b), 'a change in angle/channel/email must NOT be reported as "unchanged"');
});

test('recordsEqual still reports true identical records as equal (no false-positive rewrites)', () => {
  const a = { message: 'same', whyNow: 'same', variations: ['same'], angle: 'gift', channel: 'text', email: null, callScript: null };
  const b = { ...a };
  assert.ok(recordsEqual(a, b));
});

test('P1 regression end-to-end: runTemplate never writes an "undefined link" card for a warm breakup with no stall', async () => {
  const env = { PORTAL_KV: fakeKv() };
  const due = [
    dueItem({ contactId: 'warm-breakup-no-stall', variant: 'warm', step: 4, totalSteps: 4, state: 'breakup', isBreakup: true }),
    dueItem({ contactId: 'cold-breakup-normal', variant: 'cold', step: 5, totalSteps: 5, state: 'breakup', isBreakup: true }),
  ];
  const records = await runTemplate(env, due, new Set(), new Map());
  assert.equal(records.find((r) => r.contactId === 'warm-breakup-no-stall'), undefined, 'no card at all for the warm no-stall breakup');
  const coldCard = records.find((r) => r.contactId === 'cold-breakup-normal');
  assert.ok(coldCard, 'the cold breakup (gentle-no) must still get a card');
  assert.doesNotMatch(coldCard.message, /undefined/);
});
