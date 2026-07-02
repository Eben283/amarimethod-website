// Regression guard for the phantom-reply bug (2026-06-17 audit): GHL omits the
// `direction` field on outbound campaign emails, so our own cold-emails were stored
// as inbound → fake "droppedReplies" → false reply-waiting. touchDir must treat a
// direction-less email as outbound, without ever flipping a real inbound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchDir, resolveLineType } from '../src/sync.js';

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
