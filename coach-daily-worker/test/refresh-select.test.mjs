// refreshCallCards used to slice the top REFRESH_MAX (40) of the priority-sorted due
// list, so the warm-stalled tail (priority 15, positions 68-74) never got a fresh
// call-coach record — the exact contacts where a written decline / already-answered
// reply hides and a stale record re-pitches them (grading report §4: Mark O'Keefe,
// Harriet Fajkowski, TJ). selectRefreshContacts re-partitions: the engaged/warm tail
// is ALWAYS refreshed, then the rest fill by priority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRefreshContacts } from '../src/index.js';

// A big cold no-reply block (high priority) + a warm-stalled tail (priority 15).
const cold = Array.from({ length: 50 }, (_, i) => ({
  contactId: `cold${i}`, state: 'no-reply', priority: 70 - i, inCount: 0, talkedCall: false, droppedReplies: 0,
}));
const warmTail = ['tj', 'mark', 'harriet', 'nicki'].map((id) => ({
  contactId: id, state: 'warm-stalled', priority: 15, inCount: 0, talkedCall: true, droppedReplies: 0,
}));
const due = [...cold, ...warmTail].sort((a, b) => b.priority - a.priority); // priority-sorted, warm tail last

test('the warm-stalled tail is ALWAYS refreshed even though it sits below the top 40', () => {
  const picked = selectRefreshContacts(due, 40);
  for (const id of ['tj', 'mark', 'harriet', 'nicki']) {
    assert.ok(picked.includes(id), `${id} (warm-stalled tail) must be refreshed`);
  }
});

test('the top-priority cold contacts are still refreshed (no regression on the head)', () => {
  const picked = selectRefreshContacts(due, 40);
  assert.ok(picked.includes('cold0'), 'highest-priority contact must be refreshed');
  assert.ok(picked.includes('cold39'), 'the 40th-priority contact must be refreshed');
});

test('engagement is detected via inbound / talkedCall / droppedReplies, not just state', () => {
  const list = [
    { contactId: 'a', state: 'no-reply', priority: 5, inCount: 2, talkedCall: false, droppedReplies: 0 },
    { contactId: 'b', state: 'no-reply', priority: 4, inCount: 0, talkedCall: false, droppedReplies: 1 },
    { contactId: 'c', state: 'no-reply', priority: 3, inCount: 0, talkedCall: true, droppedReplies: 0 },
    { contactId: 'd', state: 'no-reply', priority: 2, inCount: 0, talkedCall: false, droppedReplies: 0 },
  ];
  const picked = selectRefreshContacts(list, 1); // budget of 1 for the priority fill
  assert.ok(picked.includes('a') && picked.includes('b') && picked.includes('c'), 'all engaged contacts always included');
});

test('de-dupes contact ids and never returns a blank id', () => {
  const list = [
    { contactId: 'x', state: 'no-reply', priority: 9, inCount: 1 },
    { contactId: 'x', state: 'no-reply', priority: 8, inCount: 1 },
    { contactId: '', state: 'no-reply', priority: 7 },
    { contactId: null, state: 'no-reply', priority: 6 },
  ];
  const picked = selectRefreshContacts(list, 40);
  assert.deepEqual(picked, ['x']);
});

test('respects the engaged ceiling so a flood of warm contacts cannot blow the wall-clock', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({
    contactId: `w${i}`, state: 'warm-stalled', priority: 15, inCount: 1,
  }));
  const picked = selectRefreshContacts(many, 40, 40);
  assert.ok(picked.length <= 80, 'total stays bounded (engagedMax + max)');
});
