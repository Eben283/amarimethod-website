// Regression guard for the phantom-reply bug (2026-06-17 audit): GHL omits the
// `direction` field on outbound campaign emails, so our own cold-emails were stored
// as inbound → fake "droppedReplies" → false reply-waiting. touchDir must treat a
// direction-less email as outbound, without ever flipping a real inbound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchDir, resolveLineType, profileFromContact, staleProfileIds } from '../src/sync.js';

test('direction-less EMAIL is outbound (our campaign email, not a phantom reply)', () => {
  assert.equal(touchDir({ direction: undefined }, 'email'), 'out');
  assert.equal(touchDir({ direction: null }, 'email'), 'out');
});

test('real inbound is still inbound (never hide a genuine reply)', () => {
  assert.equal(touchDir({ direction: 'inbound' }, 'email'), 'in');
  assert.equal(touchDir({ direction: 1 }, 'sms'), 'in');
  assert.equal(touchDir({ direction: 'inbound' }, 'sms'), 'in');
});

test('explicit outbound stays outbound; non-email with missing direction stays inbound', () => {
  assert.equal(touchDir({ direction: 'outbound' }, 'sms'), 'out');
  assert.equal(touchDir({ direction: 0 }, 'call'), 'out');
  // A direction-less SMS/call is NOT assumed outbound (only emails omit direction).
  assert.equal(touchDir({ direction: undefined }, 'sms'), 'in');
});

// Regression guard: the AbstractAPI classification path (classify-line-type.mjs)
// computes isVoip SEPARATELY from type — a number can come back type "mobile"
// with isVoip true, since the carrier_type text just didn't literally say
// "voip". Reading only .type silently drops that signal and lets a real VoIP
// number read as textable downstream (it would get texted, never land, and
// the send would still count as a landed touch).
test('resolveLineType returns "voip" when isVoip is true, even if type says something else', () => {
  assert.equal(resolveLineType({ type: 'mobile', isVoip: true }), 'voip');
  assert.equal(resolveLineType({ type: 'landline', isVoip: true }), 'voip');
});

test('resolveLineType falls back to type when isVoip is false', () => {
  assert.equal(resolveLineType({ type: 'mobile', isVoip: false }), 'mobile');
  assert.equal(resolveLineType({ type: 'landline', isVoip: false }), 'landline');
});

test('resolveLineType handles a missing/undefined entry without throwing', () => {
  assert.equal(resolveLineType(undefined), null);
  assert.equal(resolveLineType(null), null);
  assert.equal(resolveLineType({}), null);
});

// Provenance fix (2026-07-02): buildCard needs the contact's EMAIL in the conv:{id}
// dossier to detect placeholder-import contacts (*@amari-prospect.placeholder) whose
// phone is unverified CSV research. profileFromContact maps a GHL contact fetch to
// the stored dossier profile — it must carry email through, and stay null-safe.
test('profileFromContact carries the contact email into the dossier profile', () => {
  const profile = profileFromContact({
    firstName: 'Oxana', lastName: 'Petrova',
    email: 'oxana.petrova.linkedin@amari-prospect.placeholder',
    customFields: [{ id: 'FGakk9CgiRqeY0tleGQD', value: 'Trainer' }],
  }, 1234);
  assert.equal(profile.email, 'oxana.petrova.linkedin@amari-prospect.placeholder');
  assert.equal(profile.firstName, 'Oxana');
  assert.equal(profile.role, 'Trainer');
  assert.equal(profile.dossierFetchedAt, 1234);
});

test('profileFromContact is null-safe: missing email/fields → nulls, not throws', () => {
  const profile = profileFromContact({}, 99);
  assert.equal(profile.email, null);
  assert.equal(profile.role, null);
  assert.equal(profile.business, null);
  assert.equal(profile.rundown, null);
  assert.equal(profile.firstName, '');
});

// Dossier-staleness fix (2026-07-03, grading report line 54): the changed-conversation
// pass only refreshes a contact's profile (firstName/role/rundown) when it has NEW
// messages, so a GHL rename on a quiet contact never propagates (Mike Jigalin stayed
// "Jennifer"; Brendan Vu "Brandon"). staleProfileIds picks the contacts whose cached
// profile is older than the TTL, oldest-first and capped, skipping any refreshed this run.
const DAY = 86_400_000;
const NOW = 1_000 * DAY; // arbitrary large "now"

test('staleProfileIds picks profiles older than the TTL, oldest first', () => {
  const recs = [
    { contactId: 'fresh', dossierFetchedAt: NOW - 1 * DAY },   // within TTL
    { contactId: 'old', dossierFetchedAt: NOW - 10 * DAY },    // stale
    { contactId: 'oldest', dossierFetchedAt: NOW - 30 * DAY }, // stalest
  ];
  const ids = staleProfileIds(recs, new Set(), NOW, 7 * DAY, 10);
  assert.deepEqual(ids, ['oldest', 'old'], 'stale ones only, oldest first, fresh excluded');
});

test('staleProfileIds treats a never-fetched profile (no dossierFetchedAt) as stale', () => {
  const recs = [{ contactId: 'never', dossierFetchedAt: null }, { contactId: 'also', dossierFetchedAt: undefined }];
  const ids = staleProfileIds(recs, new Set(), NOW, 7 * DAY, 10);
  assert.ok(ids.includes('never') && ids.includes('also'), 'a profile never fetched must be refreshed');
});

test('staleProfileIds skips contacts already refreshed this run and honors the cap', () => {
  const recs = [
    { contactId: 'a', dossierFetchedAt: NOW - 30 * DAY },
    { contactId: 'b', dossierFetchedAt: NOW - 20 * DAY },
    { contactId: 'c', dossierFetchedAt: NOW - 10 * DAY },
  ];
  const ids = staleProfileIds(recs, new Set(['a']), NOW, 7 * DAY, 1);
  assert.deepEqual(ids, ['b'], 'a excluded (already refreshed), cap=1 keeps only the oldest remaining');
});

test('staleProfileIds returns nothing when every profile is fresh', () => {
  const recs = [{ contactId: 'a', dossierFetchedAt: NOW - 1 * DAY }];
  assert.deepEqual(staleProfileIds(recs, new Set(), NOW, 7 * DAY, 10), []);
});
