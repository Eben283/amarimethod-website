// Regression guard for the phantom-reply bug (2026-06-17 audit): GHL omits the
// `direction` field on outbound campaign emails, so our own cold-emails were stored
// as inbound → fake "droppedReplies" → false reply-waiting. touchDir must treat a
// direction-less email as outbound, without ever flipping a real inbound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchDir, resolveLineType, profileFromContact } from '../src/sync.js';

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
