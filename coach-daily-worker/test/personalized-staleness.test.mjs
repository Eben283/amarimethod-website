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

// ---- R2: same-day / timezone boundary ---------------------------------------
test('R2: a touch at 08:00 ON the authoring day does NOT invalidate (same-day / prior-evening-Pacific guard)', () => {
  // generatedAt 2026-06-14 floors to UTC midnight; a touch at 08:00 that day is
  // gen + 8h, inside the authoring day — must not count as "after".
  const conv = { firstName: 'Alex', touches: [{ ts: Date.parse('2026-06-14T08:00:00Z'), dir: 'out', kind: 'sms' }] };
  assert.equal(personalizedStaleReason(card(), conv, null).stale, false);
});

test('R2: a prior-evening PACIFIC touch (UTC-midnight boundary) does NOT invalidate', () => {
  // 2026-06-13 22:00 PT == 2026-06-14T05:00Z — after the naive UTC-midnight
  // anchor but still the authoring day / earlier. Must not invalidate.
  const conv = { firstName: 'Alex', touches: [{ ts: Date.parse('2026-06-14T05:00:00Z'), dir: 'out', kind: 'call' }] };
  assert.equal(personalizedStaleReason(card(), conv, null).stale, false);
});

test('R2: a touch the NEXT day still invalidates (acted-on)', () => {
  const conv = { firstName: 'Alex', touches: [{ ts: Date.parse('2026-06-15T08:00:00Z'), dir: 'out', kind: 'sms' }] };
  const r = personalizedStaleReason(card(), conv, null);
  assert.equal(r.stale, true);
  assert.equal(r.reason, 'acted-on');
});

// ---- R3: generic salutation openers -----------------------------------------
test('R3: "Hi there," is not a name → NOT stale even against a real firstName', () => {
  const c = card({ message: 'Hi there, just following up on your visit.', name: 'Michael' });
  assert.equal(personalizedStaleReason(c, { firstName: 'Michael', touches: [] }, null).stale, false);
});

test('R3: generic salutations parse to null (not a greeting name)', () => {
  for (const g of ['Hi there,', 'Hey team,', 'Hello all,', 'Hi friend,', 'Hi folks,', 'Hey everyone!', "Hi y'all,"]) {
    assert.equal(parseGreetingName(g), null, `"${g}" must not yield a name`);
  }
  assert.equal(parseGreetingName('Hi Michael,'), 'Michael', 'a real name still parses');
});

// ---- R5: 2-char known-nickname collision ------------------------------------
test('R5: "Al" matches "Alexander" despite the al→albert canonical collision', () => {
  assert.equal(namesMatch('Al', 'Alexander'), true);
  assert.equal(namesMatch('Al', 'Albert'), true);
  assert.equal(namesMatch('TJ', 'Tyler'), false, 'an unknown 2-char token still mismatches');
});

// ---- R1: retirement circuit breaker -----------------------------------------
test('R1: breaker trips when > 60% would retire — refuses ALL destructive retirement, keeps every card protected', async () => {
  // 4 of 5 stale via greeting mismatch = 80% > 60% → breaker trips.
  const mk = (n, greet, fn) => ({
    contactId: n, source: 'personalized', generatedAt: '2026-06-14', name: fn,
    message: `Hi ${greet}, checking in.`,
  });
  const pers = [
    mk('c1', 'Zoltan', 'Alice'), mk('c2', 'Zoltan', 'Bob'),
    mk('c3', 'Zoltan', 'Carol'), mk('c4', 'Zoltan', 'Dave'),
    mk('c5', 'Alex', 'Alex'), // fresh (greeting matches)
  ];
  const seed = { 'coach:personalized': pers, 'coach:records:snapshot': pers.map((p) => ({ ...p, source: 'personalized' })) };
  for (const p of pers) {
    seed[`coach:${p.contactId}`] = { ...p, source: 'personalized' };
    seed[`conv:${p.contactId}`] = { firstName: p.name, touches: [] };
  }
  const kv = fakeKv(seed);
  await runTemplate({ PORTAL_KV: kv }, [], new Set(), new Map());

  assert.equal(kv._store.get('coach:personalized').length, 5, 'coach:personalized is untouched when the breaker trips');
  assert.equal(kv._store.has('coach:personalized:retired'), false, 'no archive written when the breaker trips');
  for (const p of pers) {
    assert.ok(kv._store.has(`coach:${p.contactId}`), `physical card ${p.contactId} preserved`);
  }
  const status = kv._store.get('coach:retireBreaker:lastTripped');
  assert.ok(status && status.would === 4 && status.of === 5, 'the trip is recorded in status');
});

test('R1: at/below the 60% floor, retirement proceeds normally', async () => {
  // 1 of 2 stale = 50% ≤ 60% → not tripped.
  const stale = { contactId: 's', source: 'personalized', generatedAt: '2026-06-14', name: 'TJ', message: 'Hi Dana, hi.' };
  const fresh = { contactId: 'f', source: 'personalized', generatedAt: '2026-06-14', name: 'Alex', message: 'Hi Alex, hi.' };
  const kv = fakeKv({
    'coach:personalized': [stale, fresh],
    'coach:records:snapshot': [{ ...stale, source: 'personalized' }, { ...fresh, source: 'personalized' }],
    'coach:s': { ...stale, source: 'personalized' }, 'coach:f': { ...fresh, source: 'personalized' },
    'conv:s': { firstName: 'TJ', touches: [] }, 'conv:f': { firstName: 'Alex', touches: [] },
  });
  await runTemplate({ PORTAL_KV: kv }, [], new Set(), new Map());
  assert.deepEqual(kv._store.get('coach:personalized').map((p) => p.contactId), ['f']);
  assert.equal(kv._store.get('coach:personalized:retired').length, 1);
  assert.equal(kv._store.has('coach:retireBreaker:lastTripped'), false, 'no trip status on a normal run');
});

// ---- R4: concurrent-write safety + archive de-dupe --------------------------
test('R4: an entry authored between the read and the overwrite is preserved (re-read + merge, not clobber)', async () => {
  const stale = { contactId: 's', source: 'personalized', generatedAt: '2026-06-14', name: 'TJ', message: 'Hi Dana, hi.' };
  const fresh = { contactId: 'f', source: 'personalized', generatedAt: '2026-06-14', name: 'Alex', message: 'Hi Alex, hi.' };
  const newcomer = { contactId: 'n', source: 'personalized', generatedAt: '2026-07-03', name: 'Newby', message: 'Hi Newby, hi.' };

  const store = new Map(Object.entries({
    'coach:records:snapshot': [{ ...stale, source: 'personalized' }, { ...fresh, source: 'personalized' }],
    'coach:s': { ...stale, source: 'personalized' }, 'coach:f': { ...fresh, source: 'personalized' },
    'conv:s': { firstName: 'TJ', touches: [] }, 'conv:f': { firstName: 'Alex', touches: [] },
  }));
  // coach:personalized read #1 = [stale, fresh]; a concurrent author adds
  // `newcomer` before our re-read (read #2 = [stale, fresh, newcomer]).
  let reads = 0;
  const kv = {
    get: async (key, type) => {
      if (key === 'coach:personalized') {
        reads++;
        const val = reads === 1 ? [stale, fresh] : [stale, fresh, newcomer];
        return JSON.parse(JSON.stringify(val));
      }
      return type === 'json' ? (store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : null) : store.get(key) ?? null;
    },
    put: async (key, value) => { store.set(key, JSON.parse(value)); },
    delete: async (key) => { store.delete(key); },
    _store: store,
  };
  await runTemplate({ PORTAL_KV: kv }, [], new Set(), new Map());
  const ids = store.get('coach:personalized').map((p) => p.contactId).sort();
  assert.deepEqual(ids, ['f', 'n'], 'the concurrently-added card survives; only the confirmed-stale one is removed');
});

test('R4/R6: the retired archive de-dupes by contactId (a re-run does not bloat it)', async () => {
  const stale = { contactId: 's', source: 'personalized', generatedAt: '2026-06-14', name: 'TJ', message: 'Hi Dana, hi.' };
  const fresh = { contactId: 'f', source: 'personalized', generatedAt: '2026-06-14', name: 'Alex', message: 'Hi Alex, hi.' };
  const kv = fakeKv({
    'coach:personalized': [stale, fresh],
    'coach:records:snapshot': [{ ...stale, source: 'personalized' }, { ...fresh, source: 'personalized' }],
    'coach:s': { ...stale, source: 'personalized' }, 'coach:f': { ...fresh, source: 'personalized' },
    'conv:s': { firstName: 'TJ', touches: [] }, 'conv:f': { firstName: 'Alex', touches: [] },
    // an older archive entry for the SAME contact from a prior partial run.
    'coach:personalized:retired': [{ ...stale, retiredReason: 'acted-on', retiredAt: '2026-07-01T00:00:00Z' }],
  });
  await runTemplate({ PORTAL_KV: kv }, [], new Set(), new Map());
  const retired = kv._store.get('coach:personalized:retired');
  assert.equal(retired.length, 1, 'same contactId collapses to one archive entry');
  assert.equal(retired[0].retiredReason, 'greeting-mismatch', 'the newer retirement wins');
});
