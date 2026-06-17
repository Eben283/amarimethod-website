// Regression guard for the phantom-reply bug (2026-06-17 audit): GHL omits the
// `direction` field on outbound campaign emails, so our own cold-emails were stored
// as inbound → fake "droppedReplies" → false reply-waiting. touchDir must treat a
// direction-less email as outbound, without ever flipping a real inbound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchDir } from '../src/sync.js';

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
