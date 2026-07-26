// Test-only stateful fake D1 for the nurture tables + automation_events. Same approach as
// reminder-engine-worker's inline fakes, shared here because store.test.js AND engine.test.js
// both need it. Regex-dispatches on the SQL the store actually issues.

export function fakeD1() {
  const enrollments = new Map();
  const steps = [];
  const events = [];
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      const a = this._args;
      if (/INSERT INTO nurture_enrollments/.test(sql)) {
        const [id, sequence_id, contact_id, entered_at, status, guard_unchecked] = a;
        if (enrollments.has(id)) return { meta: { changes: 0 } };
        enrollments.set(id, { enrollment_id: id, sequence_id, contact_id, entered_at, status, guard_unchecked });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO nurture_steps/.test(sql)) {
        const [enrollment_id, step_index, after, kind, template, due_at, status] = a;
        steps.push({ enrollment_id, step_index, after, kind, template, due_at, status });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO automation_events/.test(sql)) {
        const [ts, engine, flow_key, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail] = a;
        events.push({ ts, engine, flow_key, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail });
        return { meta: { changes: 1 } };
      }
      if (/UPDATE nurture_steps SET status = 'exited' WHERE enrollment_id = \? AND status = 'pending'/.test(sql)) {
        const [id] = a; let c = 0;
        for (const s of steps) if (s.enrollment_id === id && s.status === "pending") { s.status = "exited"; c++; }
        return { meta: { changes: c } };
      }
      if (/UPDATE nurture_steps SET status = \? WHERE enrollment_id = \? AND step_index = \?/.test(sql)) {
        const [status, id, idx] = a; let c = 0;
        for (const s of steps) if (s.enrollment_id === id && s.step_index === idx) { s.status = status; c++; }
        return { meta: { changes: c } };
      }
      if (/UPDATE nurture_enrollments SET status = 'exited'/.test(sql)) {
        const [id] = a; const e = enrollments.get(id);
        if (e && e.status === "active") { e.status = "exited"; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      return { meta: { changes: 0 } };
    },
    async all() {
      const a = this._args;
      if (/FROM nurture_steps s\s+JOIN nurture_enrollments e/.test(sql)) {
        const [nowMs, limit] = a;
        const rows = steps
          .filter((s) => s.status === "pending" && s.due_at <= nowMs)
          .map((s) => ({ s, e: enrollments.get(s.enrollment_id) }))
          .filter(({ e }) => e && e.status === "active")
          .sort((x, y) => x.s.due_at - y.s.due_at)
          .slice(0, limit)
          .map(({ s, e }) => ({
            enrollment_id: s.enrollment_id, step_index: s.step_index, after: s.after, kind: s.kind,
            template: s.template, due_at: s.due_at, step_status: s.status,
            sequence_id: e.sequence_id, contact_id: e.contact_id, entered_at: e.entered_at,
          }));
        return { results: rows };
      }
      if (/FROM nurture_enrollments WHERE contact_id = \? AND status = 'active'/.test(sql)) {
        const [contactId] = a;
        return {
          results: [...enrollments.values()]
            .filter((e) => e.contact_id === contactId && e.status === "active")
            .map((e) => ({ enrollment_id: e.enrollment_id, sequence_id: e.sequence_id, contact_id: e.contact_id })),
        };
      }
      return { results: [] };
    },
  });
  return { prepare, _enrollments: enrollments, _steps: steps, _events: events };
}
