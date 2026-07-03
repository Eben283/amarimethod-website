// Frozen-draft invalidation tests (ops/docs/2026-07-03-frozen-draft-invalidation-spec.md).
//
// The pure decision (personalizedStaleReason + greeting/nickname helpers) is
// tested directly; the retirement side effects (drop protection, archive the
// stale entry, remove it from coach:personalized) are tested end-to-end through
// runTemplate with an in-memory KV.
//
// Run: `cd coach-daily-worker && npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  personalizedStaleReason,
  greetingMismatch,
  namesMatch,
  parseGreetingName,
} from '../src/personalized-staleness.js';
import { runTemplate } from '../src/template.js';

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: async (key, type) => (type === 'json' ? (store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : null) : store.get(key) ?? null),
    put: async (key, value) => { store.set(key, JSON.parse(value)); },
    delete: async (key) => { store.delete(key); },
    _store: store,
  };
}

const card = (over = {}) => ({
  contactId: 'p1', source: 'personalized', generatedAt: '2026-06-14',
  channel: 'text', bucket: 'reconnect', name: 'Alex Rivera',
  message: 'Hi Alex, wanted to check back in about your sessions.', whyNow: 'reconnect',
  ...over,
});

// ---- Rule 1: acted-on (outbound after generatedAt) --------------------------
test('acted-on: an outbound touch after generatedAt → stale (rule 1)', () => {
  const conv = { firstName: 'Alex', touches: [{ ts: '2026-06-20T10:00:00Z', dir: 'out', kind: 'sms' }] };
  const r = personalizedStaleReason(card(), conv, null);
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'acted-on');
});

test('acted-on takes precedence: an outbound touch before generatedAt does NOT invalidate', () => {
  const conv = { firstName: 'Alex', touches: [{ ts: '2026-06-10T10:00:00Z', dir: 'out', kind: 'sms' }] };
  const r = personalizedStaleReason(card(), conv, null);
  assert.equal(r.stale, false);
});

// ---- Rule 2: replied (inbound after generatedAt) ----------------------------
test('replied: an inbound touch after generatedAt → stale (rule 2)', () => {
  const conv = { firstName: 'Alex', touches: [{ ts: '2026-06-18T09:00:00Z', dir: 'in', kind: 'sms', text: 'sounds good' }] };
  const r = personalizedStaleReason(card(), conv, null);
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'replied');
});

test('acted-on works with REAL-DATA epoch-millis numeric ts (conv touches store ts as a number, not ISO)', () => {
  // Regression: Date.parse(number) is NaN, which silently disabled rules 1 & 2
  // against live data. generatedAt 2026-06-14 = 1781740800000; touch is after.
  const conv = { firstName: 'Alex', touches: [{ ts: 1782253347048, dir: 'out', kind: 'sms' }] };
  const r = personalizedStaleReason(card(), conv, null);
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'acted-on');
});

test('numeric ts BEFORE generatedAt still does not invalidate', () => {
  const conv = { firstName: 'Alex', touches: [{ ts: 1777917632963, dir: 'out', kind: 'call' }] };
  assert.equal(personalizedStaleReason(card(), conv, null).stale, false);
});

// ---- Rule 3: decline holdState ----------------------------------------------
test('decline: holdState cool-off → stale (rule 3)', () => {
  const conv = { firstName: 'Alex', touches: [] };
  const r = personalizedStaleReason(card(), conv, { holdState: 'cool-off' });
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'decline');
});

test('decline: holdState close-loop → stale (rule 3)', () => {
  const r = personalizedStaleReason(card(), { firstName: 'Alex', touches: [] }, { holdState: 'close-loop' });
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'decline');
});

test('active holdState alone does NOT invalidate', () => {
  const r = personalizedStaleReason(card(), { firstName: 'Alex', touches: [] }, { holdState: 'active' });
  assert.equal(r.stale, false);
});

// ---- Rule 4: greeting mismatch ----------------------------------------------
test('greeting mismatch: "Hi Dana" but firstName "TJ" → stale (rule 4)', () => {
  const c = card({ message: 'Hi Dana, following up on your visit.', name: 'TJ (front desk)' });
  const r = personalizedStaleReason(c, { firstName: 'TJ', touches: [] }, null);
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'greeting-mismatch');
});

test('greeting mismatch uses the message greeting, NOT the name label field', () => {
  // name label is a note; the greeting "Yotam" vs firstName "Brendan" is the mismatch.
  const c = card({ message: 'Hey Yotam, checking in.', name: 'Brendan Vu (referral)' });
  const r = personalizedStaleReason(c, { firstName: 'Brendan', touches: [] }, null);
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'greeting-mismatch');
});

// ---- Nickname guard (decision 2) --------------------------------------------
test('NICKNAME GUARD: "Hi Mike" with firstName "Michael" → STAYS protected', () => {
  const c = card({ message: 'Hi Mike, wanted to reconnect.', name: 'Michael' });
  const r = personalizedStaleReason(c, { firstName: 'Michael', touches: [] }, null);
  assert.equal(r.stale, false, 'Mike is a nickname of Michael — must not invalidate');
});

test('NICKNAME GUARD covers Rob/Robert (prefix) and Tom/Thomas (lookup)', () => {
  assert.equal(namesMatch('Rob', 'Robert'), true);
  assert.equal(namesMatch('Tom', 'Thomas'), true);
  assert.equal(namesMatch('Mike', 'Michael'), true);
  assert.equal(namesMatch('Jen', 'Jennifer'), true);
});

test('nickname guard does NOT swallow real mismatches', () => {
  assert.equal(namesMatch('Dana', 'TJ'), false);
  assert.equal(namesMatch('Yotam', 'Brendan'), false);
  assert.equal(namesMatch('Jennifer', 'Mike'), false);
});

test('greeting parse ignores a note-style name label and reads Hi/Hey/Hello only', () => {
  assert.equal(parseGreetingName('Hi Dana, ...'), 'Dana');
  assert.equal(parseGreetingName('Hey TJ!'), 'TJ');
  assert.equal(parseGreetingName('Hello Sarah-Jane, ...'), 'Sarah-Jane');
  assert.equal(parseGreetingName('Just following up.'), null);
});

test('greeting parse reads past a coaching preamble ("When you reach her: Hi Dana, ...")', () => {
  // Real-data shape: some drafts open with a delivery instruction before the
  // actual greeting. Parse the greeting after the colon, not the preamble.
  assert.equal(parseGreetingName('When you reach her: Hi Dana, it\'s Garrett.'), 'Dana');
  const c = card({ message: 'When you reach her: Hi Dana, it\'s Garrett.', name: 'Dana Schuman' });
  const r = personalizedStaleReason(c, { firstName: 'TJ', touches: [] }, null);
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'greeting-mismatch');
});

test('greeting parse does NOT false-match a "hi" mid-sentence after a period', () => {
  assert.equal(parseGreetingName('Following up. High five on booking.'), null);
});

test('greetingMismatch is false when firstName is missing (can not tell)', () => {
  assert.equal(greetingMismatch('Hi Dana, ...', ''), false);
  assert.equal(greetingMismatch('Hi Dana, ...', null), false);
});

// ---- The anti-over-invalidation guard ---------------------------------------
test('fresh: no touches after generatedAt, greeting matches, active hold → STAYS protected', () => {
  const conv = {
    firstName: 'Alex',
    touches: [{ ts: '2026-06-10T10:00:00Z', dir: 'out', kind: 'sms' }], // before generatedAt
  };
  const r = personalizedStaleReason(card(), conv, { holdState: 'active' });
  assert.equal(r.stale, false);
  assert.equal(r.reason, null);
});

test('missing/unparseable generatedAt does not invalidate on touch rules (conservative)', () => {
  const conv = { firstName: 'Alex', touches: [{ ts: '2026-06-20T10:00:00Z', dir: 'out', kind: 'sms' }] };
  const r = personalizedStaleReason(card({ generatedAt: undefined }), conv, null);
  assert.equal(r.stale, false);
});

// ---- Retirement side effects through runTemplate ----------------------------
test('a stale personalized card is retired: archived to coach:personalized:retired and removed from the protected set', async () => {
  const staleCard = card({
    contactId: 'stale-1', name: 'TJ', message: 'Hi Dana, following up.',
    generatedAt: '2026-06-14',
  });
  const freshCard = card({
    contactId: 'fresh-1', name: 'Alex Rivera', message: 'Hi Alex, checking in.',
    generatedAt: '2026-06-14',
  });
  const kv = fakeKv({
    'coach:personalized': [staleCard, freshCard],
    'coach:records:snapshot': [
      { ...staleCard, source: 'personalized' },
      { ...freshCard, source: 'personalized' },
    ],
    'coach:stale-1': { ...staleCard, source: 'personalized' },
    'coach:fresh-1': { ...freshCard, source: 'personalized' },
    'conv:stale-1': { firstName: 'TJ', touches: [] },      // greeting Dana ≠ TJ → stale
    'conv:fresh-1': { firstName: 'Alex', touches: [] },    // greeting Alex = Alex → fresh
  });
  const env = { PORTAL_KV: kv };

  await runTemplate(env, [], new Set(), new Map());

  const remaining = kv._store.get('coach:personalized');
  assert.deepEqual(remaining.map((p) => p.contactId), ['fresh-1'], 'only the fresh card keeps its protection');

  const retired = kv._store.get('coach:personalized:retired');
  assert.ok(Array.isArray(retired) && retired.length === 1, 'the stale card is archived, not lost');
  assert.equal(retired[0].contactId, 'stale-1');
  assert.equal(retired[0].retiredReason, 'greeting-mismatch');
  assert.ok(retired[0].retiredAt, 'retirement is timestamped');

  const snapshot = kv._store.get('coach:records:snapshot');
  assert.equal(snapshot.some((r) => r.contactId === 'stale-1'), false, 'retired card leaves the snapshot');
  assert.ok(snapshot.some((r) => r.contactId === 'fresh-1'), 'fresh card stays in the snapshot');

  // The physical card the panel reads is gone for a retired, non-regenerated contact.
  assert.equal(kv._store.has('coach:stale-1'), false, 'stale physical card is cleared');
  assert.ok(kv._store.has('coach:fresh-1'), 'fresh physical card is untouched');
});

test('with nothing stale, no retirement archive is created and protection is unchanged', async () => {
  const freshCard = card({ contactId: 'fresh-1', name: 'Alex Rivera', message: 'Hi Alex, checking in.' });
  const kv = fakeKv({
    'coach:personalized': [freshCard],
    'coach:records:snapshot': [{ ...freshCard, source: 'personalized' }],
    'coach:fresh-1': { ...freshCard, source: 'personalized' },
    'conv:fresh-1': { firstName: 'Alex', touches: [] },
  });
  await runTemplate({ PORTAL_KV: kv }, [], new Set(), new Map());
  assert.equal(kv._store.has('coach:personalized:retired'), false, 'no archive when nothing is stale');
  assert.deepEqual(kv._store.get('coach:personalized').map((p) => p.contactId), ['fresh-1']);
});
