import { describe, it, expect } from 'vitest';
import { claimDebit, releaseDebit, finalizeDebit, isDebited } from './attendance-claim.js';

// Minimal in-memory fake of the D1 binding. Models the only behavior that matters:
// INSERT ... ON CONFLICT(appointment_id) DO NOTHING reports changes=1 on a fresh
// insert and changes=0 when the PRIMARY KEY already exists — the atomic compare-and-set
// the real fix depends on.
function fakeD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        _sql: sql,
        _args: [],
        bind(...args) { this._args = args; return this; },
        async run() {
          if (/^INSERT INTO attended_debits/.test(this._sql)) {
            const [apptId, contactId, claimedAt] = this._args;
            if (rows.has(apptId)) return { meta: { changes: 0 } }; // conflict → didn't claim
            rows.set(apptId, {
              appointment_id: apptId, contact_id: contactId, claimed_at: claimedAt,
              applied_at: null, completed: null, remaining: null,
            });
            return { meta: { changes: 1 } };
          }
          if (/^DELETE FROM attended_debits/.test(this._sql)) {
            const [apptId] = this._args;
            return { meta: { changes: rows.delete(apptId) ? 1 : 0 } };
          }
          if (/^UPDATE attended_debits/.test(this._sql)) {
            const [appliedAt, completed, remaining, apptId] = this._args;
            const row = rows.get(apptId);
            if (row) Object.assign(row, { applied_at: appliedAt, completed, remaining });
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          if (/^SELECT 1 FROM attended_debits/.test(this._sql)) {
            return rows.has(this._args[0]) ? { 1: 1 } : null;
          }
          return null;
        },
      };
    },
  };
}

describe('attendance-claim — atomic debit claim (D1)', () => {
  it('first claim wins, second claim on the same appointment loses (the CAS)', async () => {
    const db = fakeD1();
    expect(await claimDebit(db, 'appt-1', 'contact-A')).toBe(true);
    expect(await claimDebit(db, 'appt-1', 'contact-A')).toBe(false);
  });

  it('different appointments each get their own claim', async () => {
    const db = fakeD1();
    expect(await claimDebit(db, 'appt-1', 'c1')).toBe(true);
    expect(await claimDebit(db, 'appt-2', 'c1')).toBe(true);
  });

  it('isDebited reflects claim state', async () => {
    const db = fakeD1();
    expect(await isDebited(db, 'appt-1')).toBe(false);
    await claimDebit(db, 'appt-1', 'c1');
    expect(await isDebited(db, 'appt-1')).toBe(true);
  });

  it('releaseDebit frees the claim so a retry can re-claim (re-apply after a failed write)', async () => {
    const db = fakeD1();
    expect(await claimDebit(db, 'appt-1', 'c1')).toBe(true);
    await releaseDebit(db, 'appt-1');
    expect(await isDebited(db, 'appt-1')).toBe(false);
    expect(await claimDebit(db, 'appt-1', 'c1')).toBe(true); // re-claim succeeds
  });

  it('finalizeDebit stamps the applied result onto the claim row', async () => {
    const db = fakeD1();
    await claimDebit(db, 'appt-1', 'c1');
    await finalizeDebit(db, 'appt-1', 5, 3);
    const row = db.rows.get('appt-1');
    expect(row.completed).toBe(5);
    expect(row.remaining).toBe(3);
    expect(row.applied_at).toBeTruthy();
  });

  it('changes can arrive as meta.changes or top-level changes (shape-defensive)', async () => {
    // A D1 client returning the flatter { changes } shape must still read as a win.
    const flat = {
      prepare: () => ({
        bind() { return this; },
        async run() { return { changes: 1 }; },
      }),
    };
    expect(await claimDebit(flat, 'x', 'y')).toBe(true);
  });
});
