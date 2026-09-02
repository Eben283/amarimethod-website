import { describe, it, expect, beforeEach } from "vitest";
import { enrollmentId, saveEnrollment, saveBackfilledEnrollment, retireLegacyEnrollment, loadDueSteps, markStep, appendEvent, cancelEnrollment, exitEnrollmentsForContact, exitEnrollmentsForContacts, loadDeliveryReceiptCandidates, appendDeliveryReceiptEvent } from "./store.js";

// Stateful fake of the D1 binding — models exactly the queries store.js issues, the way
// attendance-claim.test.js models its INSERT. prepare().bind().run()/.all().
function fakeD1() {
  const enrollments = new Map();
  const steps = [];
  const events = [];
  function prepare(sql) {
    return {
      _args: [],
      bind(...args) { this._args = args; return this; },
      async run() {
        const a = this._args;
        if (/INSERT INTO reminder_enrollments/.test(sql)) {
          const [id, flow_key, definition_version, appointment_id, contact_id, calendar_id, start_at, start_ms, enrolled_at, status] = a;
          if (enrollments.has(id)) return { meta: { changes: 0 } };
          enrollments.set(id, { enrollment_id: id, flow_key, definition_version, appointment_id, contact_id, calendar_id, start_at, start_ms, enrolled_at, status });
          return { meta: { changes: 1 } };
        }
        if (/INSERT INTO reminder_steps/.test(sql)) {
          const [enrollment_id, step_index, at, type, template, due_at, status] = a;
          if (steps.some((step) => step.enrollment_id === enrollment_id && step.step_index === step_index)) {
            return { meta: { changes: 0 } };
          }
          steps.push({ enrollment_id, step_index, at, type, template, due_at, status });
          return { meta: { changes: 1 } };
        }
        if (/INSERT INTO automation_events/.test(sql)) {
          if (/WHERE NOT EXISTS/.test(sql)) {
            const messageRef = a[10];
            if (events.some((event) => event.action === "delivery_status" && event.message_ref === messageRef && ["delivered", "failed", "bounced"].includes(event.outcome))) {
              return { meta: { changes: 0 } };
            }
          }
          const [ts, engine, flow_key, definition_version, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail] = a;
          events.push({ ts, engine, flow_key, definition_version, contact_id, appointment_id, step_index, action, outcome, channel, message_ref, detail });
          return { meta: { changes: 1 } };
        }
        if (/UPDATE reminder_steps SET status = 'cancelled' WHERE enrollment_id = \? AND status = 'pending'/.test(sql)) {
          const [id] = a;
          let changes = 0;
          for (const s of steps) if (s.enrollment_id === id && s.status === "pending") { s.status = "cancelled"; changes++; }
          return { meta: { changes } };
        }
        if (/UPDATE reminder_steps SET status = 'cancelled'\s+WHERE status = 'pending' AND enrollment_id IN/.test(sql)) {
          const [flowKey, ...contactIds] = a;
          const aliases = new Set(/contact_id IN \(/.test(sql) ? contactIds : contactIds.slice(0, 1));
          let changes = 0;
          for (const s of steps) {
            const e = enrollments.get(s.enrollment_id);
            if (s.status === "pending" && e && e.flow_key === flowKey && aliases.has(e.contact_id) && e.status === "active") { s.status = "cancelled"; changes++; }
          }
          return { meta: { changes } };
        }
        if (/UPDATE reminder_steps SET status = \? WHERE enrollment_id = \? AND step_index = \?/.test(sql)) {
          const [status, id, step_index] = a;
          let changes = 0;
          for (const s of steps) if (s.enrollment_id === id && s.step_index === step_index) { s.status = status; changes++; }
          return { meta: { changes } };
        }
        if (/UPDATE reminder_enrollments\s+SET status = 'failed'/.test(sql)) {
          const [id] = a;
          const e = enrollments.get(id);
          const hasFailed = steps.some((step) => step.enrollment_id === id && step.status === "failed");
          const hasPending = steps.some((step) => step.enrollment_id === id && step.status === "pending");
          if (!e || e.flow_key !== "no-show-recovery" || e.status !== "active" || !hasFailed || hasPending) {
            return { meta: { changes: 0 } };
          }
          e.status = "failed";
          return { meta: { changes: 1 } };
        }
        if (/UPDATE reminder_enrollments SET status = 'cancelled'/.test(sql)) {
          if (/flow_key = \? AND contact_id (?:= \?|IN \()/.test(sql)) {
            const [flowKey, ...contactIds] = a;
            const aliases = new Set(/contact_id IN \(/.test(sql) ? contactIds : contactIds.slice(0, 1));
            let changes = 0;
            for (const e of enrollments.values()) {
              if (e.flow_key === flowKey && aliases.has(e.contact_id) && e.status === "active") { e.status = "cancelled"; changes++; }
            }
            return { meta: { changes } };
          }
          const [id] = a;
          const e = enrollments.get(id);
          if (e) e.status = "cancelled";
          return { meta: { changes: e ? 1 : 0 } };
        }
        if (/UPDATE reminder_enrollments\s+SET definition_version = \?/.test(sql)) {
          const [definitionVersion, contactId, calendarId, startAt, startMs, enrolledAt, id, oldVersion] = a;
          const e = enrollments.get(id);
          if (!e || e.status !== "active" || e.definition_version !== oldVersion) return { meta: { changes: 0 } };
          Object.assign(e, {
            definition_version: definitionVersion,
            contact_id: contactId,
            calendar_id: calendarId,
            start_at: startAt,
            start_ms: startMs,
            enrolled_at: enrolledAt,
          });
          return { meta: { changes: 1 } };
        }
        if (/UPDATE reminder_enrollments SET status = 'retired'/.test(sql)) {
          const [id] = a;
          const e = enrollments.get(id);
          const pending = steps.some((step) => step.enrollment_id === id && step.status === "pending");
          if (!e || e.status !== "active" || e.definition_version !== 1 || pending) return { meta: { changes: 0 } };
          e.status = "retired";
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      },
      async all() {
        const a = this._args;
        if (/FROM automation_events sent/.test(sql)) {
          const [flowKey, cutoffMs, limit = Number.MAX_SAFE_INTEGER, offset = 0] = a;
          const candidates = events.filter((event) => event.engine === "reminder" && event.flow_key === flowKey && event.action === "send" && event.outcome === "sent" && event.channel === "sms" && event.message_ref && event.ts >= cutoffMs)
            .filter((event) => !events.some((receipt) => receipt.action === "delivery_status" && receipt.message_ref === event.message_ref && ["delivered", "failed", "bounced"].includes(receipt.outcome)))
            .sort((left, right) => left.ts - right.ts);
          if (/COUNT\(\*\)/.test(sql)) return { results: [{ count: candidates.length }] };
          return { results: candidates.slice(offset, offset + limit).map((event, index) => ({ id: offset + index + 1, ...event })) };
        }
        if (/FROM reminder_steps s\s+JOIN reminder_enrollments e/.test(sql)) {
          const [nowMs, limit] = a;
          const rows = steps
            .filter((s) => s.status === "pending" && s.due_at <= nowMs)
            .map((s) => ({ s, e: enrollments.get(s.enrollment_id) }))
            .filter(({ e }) => e && e.status === "active")
            .sort((x, y) => x.s.due_at - y.s.due_at)
            .slice(0, limit)
            .map(({ s, e }) => ({
              enrollment_id: s.enrollment_id, step_index: s.step_index, at: s.at, type: s.type, template: s.template, due_at: s.due_at, step_status: s.status,
              flow_key: e.flow_key, definition_version: e.definition_version, appointment_id: e.appointment_id, contact_id: e.contact_id, calendar_id: e.calendar_id, start_at: e.start_at, start_ms: e.start_ms,
            }));
          return { results: rows };
        }
        return { results: [] };
      },
      async first() {
        const [id] = this._args;
        if (/SELECT flow_key, definition_version/.test(sql)) return enrollments.get(id) || null;
        if (/SELECT e.flow_key, e.definition_version/.test(sql)) {
          const e = enrollments.get(id);
          return e ? { ...e, pending_steps: steps.filter((step) => step.enrollment_id === id && step.status === "pending").length } : null;
        }
        return null;
      },
    };
  }
  return {
    prepare,
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
    _enrollments: enrollments,
    _steps: steps,
    _events: events,
  };
}

const NOW = 1_000_000;
const enrollment = (over = {}) => ({
  flowKey: "initial-in-person",
  definitionVersion: 1,
  appointmentId: "a1",
  contactId: "c1",
  calendarId: "cal",
  startAt: "2026-07-20T15:00:00-07:00",
  startMs: 5_000_000,
  enrolledAt: NOW,
  status: "active",
  steps: [
    { stepIndex: 0, at: "enroll", type: "email", template: "confirmation", dueAt: NOW - 10, status: "pending" },
    { stepIndex: 1, at: "start-60m", type: "sms", template: "one-hour-sms", dueAt: NOW + 100_000, status: "pending" },
  ],
  ...over,
});

let db;
beforeEach(() => { db = fakeD1(); });

describe("enrollmentId", () => {
  it("joins flowKey and appointmentId", () => {
    expect(enrollmentId("initial-in-person", "a1")).toBe("initial-in-person:a1");
  });
});

describe("saveEnrollment", () => {
  it("creates the enrollment and its steps", async () => {
    const out = await saveEnrollment(db, enrollment());
    expect(out).toEqual({ created: true, enrollmentId: "initial-in-person:a1" });
    expect(db._enrollments.size).toBe(1);
    expect(db._steps).toHaveLength(2);
  });

  it("is idempotent: a duplicate booking event does not double-enroll", async () => {
    await saveEnrollment(db, enrollment());
    const second = await saveEnrollment(db, enrollment());
    expect(second.created).toBe(false);
    expect(db._steps).toHaveLength(2); // not 4
  });
});

describe("saveBackfilledEnrollment", () => {
  it("keeps an ordinary duplicate inert unless replacement is explicit", async () => {
    await saveEnrollment(db, enrollment());
    const out = await saveBackfilledEnrollment(db, enrollment({ definitionVersion: 2 }));
    expect(out).toMatchObject({ created: false, reconciled: false, cancelledSteps: 0 });
    expect(db._enrollments.get("initial-in-person:a1").definition_version).toBe(1);
    expect(db._steps).toHaveLength(2);
  });

  it("atomically advances a legacy row while preserving immutable evidence", async () => {
    await saveEnrollment(db, enrollment());
    await markStep(db, "initial-in-person:a1", 0, "would_send");
    const replacement = enrollment({
      definitionVersion: 2,
      startAt: "2026-07-27T15:00:00-07:00",
      startMs: 10_000_000,
      steps: [
        { stepIndex: 0, at: "enroll", type: "email", template: "confirmation", dueAt: NOW, status: "skipped" },
        { stepIndex: 1, at: "start-60m", type: "sms", template: "one-hour-sms", dueAt: NOW + 200_000, status: "pending" },
      ],
    });

    const out = await saveBackfilledEnrollment(db, replacement, { replaceExisting: true });

    expect(out).toMatchObject({
      created: false,
      reconciled: true,
      cancelledSteps: 1,
      previousDefinitionVersion: 1,
    });
    expect(db._enrollments.get("initial-in-person:a1")).toMatchObject({
      definition_version: 2,
      start_at: replacement.startAt,
    });
    expect(db._steps.find((step) => step.step_index === 0).status).toBe("would_send");
    expect(db._steps.find((step) => step.step_index === 1).status).toBe("cancelled");
    expect(db._steps.find((step) => step.step_index === 2001)).toMatchObject({
      template: "one-hour-sms",
      status: "pending",
    });
  });

  it("rejects replacement that does not advance the definition", async () => {
    await saveEnrollment(db, enrollment({ definitionVersion: 2 }));
    await expect(saveBackfilledEnrollment(
      db,
      enrollment({ definitionVersion: 2, startAt: "2026-07-27T15:00:00-07:00" }),
      { replaceExisting: true },
    )).rejects.toThrow("advance the workflow definition version");
  });
});

describe("retireLegacyEnrollment", () => {
  const past = "1970-01-01T00:10:00.000Z";
  const retirement = (over = {}) => ({
    flowKey: "initial-in-person", appointmentId: "a1", contactId: "c1", calendarId: "cal",
    startAt: past, providerStatus: "showed", ...over,
  });

  it("retires an exact past v1 row only after all pending work is gone", async () => {
    await saveEnrollment(db, enrollment({ startAt: past, startMs: Date.parse(past) }));
    await markStep(db, "initial-in-person:a1", 0, "would_send");
    await markStep(db, "initial-in-person:a1", 1, "would_send");

    expect(await retireLegacyEnrollment(db, retirement(), NOW)).toEqual({
      retired: true, enrollmentId: "initial-in-person:a1",
    });
    expect(db._enrollments.get("initial-in-person:a1").status).toBe("retired");
    expect(await retireLegacyEnrollment(db, retirement(), NOW)).toEqual({
      retired: false, enrollmentId: "initial-in-person:a1",
    });
  });

  it("fails closed for pending work, identity drift, current definitions, or a future appointment", async () => {
    await saveEnrollment(db, enrollment({ startAt: past, startMs: Date.parse(past) }));
    await expect(retireLegacyEnrollment(db, retirement(), NOW)).rejects.toThrow("pending work");
    await markStep(db, "initial-in-person:a1", 0, "would_send");
    await markStep(db, "initial-in-person:a1", 1, "would_send");
    await expect(retireLegacyEnrollment(db, retirement({ contactId: "wrong" }), NOW)).rejects.toThrow("identity");
    db._enrollments.get("initial-in-person:a1").definition_version = 2;
    await expect(retireLegacyEnrollment(db, retirement(), NOW)).rejects.toThrow("v1");
    db._enrollments.get("initial-in-person:a1").definition_version = 1;
    const future = "1970-01-01T01:00:00.000Z";
    db._enrollments.get("initial-in-person:a1").start_at = future;
    await expect(retireLegacyEnrollment(db, retirement({ startAt: future }), NOW)).rejects.toThrow("must be in the past");
    db._enrollments.get("initial-in-person:a1").start_at = past;
    await expect(retireLegacyEnrollment(db, retirement({ providerStatus: "cancelled" }), NOW)).rejects.toThrow("provider status");
  });
});

describe("loadDueSteps", () => {
  it("returns only pending steps whose time has come, shaped for processStep", async () => {
    await saveEnrollment(db, enrollment());
    const due = await loadDueSteps(db, NOW);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      enrollmentId: "initial-in-person:a1",
      enrollment: { flowKey: "initial-in-person", definitionVersion: 1, contactId: "c1", appointmentId: "a1" },
      step: { stepIndex: 0, type: "email", status: "pending" },
    });
  });

  it("excludes future steps and steps on cancelled enrollments", async () => {
    await saveEnrollment(db, enrollment());
    await cancelEnrollment(db, "initial-in-person:a1");
    expect(await loadDueSteps(db, NOW)).toHaveLength(0);
  });
});

describe("markStep", () => {
  it("advances a step out of the due-queue", async () => {
    await saveEnrollment(db, enrollment());
    await markStep(db, "initial-in-person:a1", 0, "sent");
    expect(await loadDueSteps(db, NOW)).toHaveLength(0);
  });

  it("closes No Show recovery as failed when its final pending step fails", async () => {
    await saveEnrollment(db, enrollment({
      flowKey: "no-show-recovery",
      steps: [{ stepIndex: 0, at: "enroll", type: "sms", template: "affiliate-missed-sms", dueAt: NOW, status: "pending" }],
    }));

    await markStep(db, "no-show-recovery:a1", 0, "failed");

    expect(db._steps[0].status).toBe("failed");
    expect(db._enrollments.get("no-show-recovery:a1").status).toBe("failed");
  });

  it("keeps No Show recovery active while a later step is still pending", async () => {
    await saveEnrollment(db, enrollment({ flowKey: "no-show-recovery" }));

    await markStep(db, "no-show-recovery:a1", 0, "failed");

    expect(db._enrollments.get("no-show-recovery:a1").status).toBe("active");
    expect(db._steps.find((step) => step.step_index === 1).status).toBe("pending");
  });

  it("does not terminally close other reminder families after a final failure", async () => {
    await saveEnrollment(db, enrollment({
      steps: [{ stepIndex: 0, at: "enroll", type: "email", template: "confirmation", dueAt: NOW, status: "pending" }],
    }));

    await markStep(db, "initial-in-person:a1", 0, "failed");

    expect(db._enrollments.get("initial-in-person:a1").status).toBe("active");
  });
});

describe("cancelEnrollment", () => {
  it("cancels the enrollment and its pending steps, leaving sent history intact", async () => {
    await saveEnrollment(db, enrollment());
    await markStep(db, "initial-in-person:a1", 0, "sent"); // step 0 already sent
    const out = await cancelEnrollment(db, "initial-in-person:a1");
    expect(out.cancelledSteps).toBe(1); // only the pending step 1
    expect(db._steps.find((s) => s.step_index === 0).status).toBe("sent");
    expect(db._steps.find((s) => s.step_index === 1).status).toBe("cancelled");
    expect(db._enrollments.get("initial-in-person:a1").status).toBe("cancelled");
  });
});

describe("exitEnrollmentsForContact", () => {
  it("cancels only the matching active flow for the rebooked person", async () => {
    await saveEnrollment(db, enrollment({ flowKey: "assessment-no-show", appointmentId: "missed", contactId: "c1" }));
    await saveEnrollment(db, enrollment({ flowKey: "assessment-no-show", appointmentId: "other-person", contactId: "c2" }));
    await saveEnrollment(db, enrollment({ flowKey: "initial-in-person", appointmentId: "other-flow", contactId: "c1" }));

    const out = await exitEnrollmentsForContact(db, "assessment-no-show", "c1");

    expect(out).toEqual({ cancelledSteps: 2, exitedEnrollments: 1 });
    expect(db._enrollments.get("assessment-no-show:missed").status).toBe("cancelled");
    expect(db._enrollments.get("assessment-no-show:other-person").status).toBe("active");
    expect(db._enrollments.get("initial-in-person:other-flow").status).toBe("active");
  });
});

describe("exitEnrollmentsForContacts", () => {
  it("closes both exact identity aliases while preserving sent evidence and other people", async () => {
    await saveEnrollment(db, enrollment({ flowKey: "no-show-recovery", appointmentId: "legacy", contactId: "ghl-c1" }));
    await saveEnrollment(db, enrollment({ flowKey: "no-show-recovery", appointmentId: "owned", contactId: "owned-c1" }));
    await saveEnrollment(db, enrollment({ flowKey: "no-show-recovery", appointmentId: "other", contactId: "owned-c2" }));
    await markStep(db, "no-show-recovery:legacy", 0, "would_send");

    const out = await exitEnrollmentsForContacts(db, "no-show-recovery", ["owned-c1", "ghl-c1", "owned-c1"]);

    expect(out).toEqual({ cancelledSteps: 3, exitedEnrollments: 2 });
    expect(db._enrollments.get("no-show-recovery:legacy").status).toBe("cancelled");
    expect(db._enrollments.get("no-show-recovery:owned").status).toBe("cancelled");
    expect(db._enrollments.get("no-show-recovery:other").status).toBe("active");
    expect(db._steps.find((step) => step.enrollment_id === "no-show-recovery:legacy" && step.step_index === 0).status)
      .toBe("would_send");
  });
});

describe("appendEvent", () => {
  it("writes an event row with detail JSON-stringified", async () => {
    await appendEvent(db, { ts: NOW, engine: "reminder", flowKey: "initial-in-person", definitionVersion: 1, contactId: "c1", stepIndex: 0, action: "would_send", outcome: "would_send", channel: "email", detail: { template: "confirmation" } });
    expect(db._events).toHaveLength(1);
    expect(db._events[0]).toMatchObject({ outcome: "would_send", channel: "email" });
    expect(db._events[0].definition_version).toBe(1);
    expect(JSON.parse(db._events[0].detail)).toEqual({ template: "confirmation" });
  });
});

describe("delivery receipt storage", () => {
  it("selects only unreconciled accepted SMS events", async () => {
    await appendEvent(db, { ts: NOW, flowKey: "initial-in-person", action: "send", outcome: "sent", channel: "sms", message_ref: "sms-1" });
    await appendEvent(db, { ts: NOW, flowKey: "initial-in-person", action: "send", outcome: "sent", channel: "email", message_ref: "email-1" });
    await appendEvent(db, { ts: NOW, flowKey: "initial-virtual", action: "send", outcome: "sent", channel: "sms", message_ref: "other-flow-sms" });
    expect(await loadDeliveryReceiptCandidates(db, NOW - 1)).toEqual([
      expect.objectContaining({ channel: "sms", message_ref: "sms-1" }),
    ]);
  });

  it("rotates bounded pages so old pending references cannot starve newer sends", async () => {
    for (let index = 0; index < 3; index += 1) {
      await appendEvent(db, { ts: NOW + index, flowKey: "initial-in-person", action: "send", outcome: "sent", channel: "sms", message_ref: `sms-${index}` });
    }
    expect((await loadDeliveryReceiptCandidates(db, NOW - 1, 1, 0))[0].message_ref).toBe("sms-0");
    expect((await loadDeliveryReceiptCandidates(db, NOW - 1, 1, 1))[0].message_ref).toBe("sms-1");
    expect((await loadDeliveryReceiptCandidates(db, NOW - 1, 1, 2))[0].message_ref).toBe("sms-2");
  });

  it("appends a terminal status once and removes that send from reconciliation", async () => {
    await appendEvent(db, { ts: NOW, flowKey: "initial-in-person", action: "send", outcome: "sent", channel: "sms", message_ref: "sms-1" });
    const receipt = { ts: NOW + 1, flowKey: "initial-in-person", action: "delivery_status", outcome: "delivered", channel: "sms", message_ref: "sms-1", detail: { providerStatus: "delivered" } };
    expect(await appendDeliveryReceiptEvent(db, receipt)).toBe(true);
    expect(await appendDeliveryReceiptEvent(db, receipt)).toBe(false);
    expect(await loadDeliveryReceiptCandidates(db, NOW - 1)).toEqual([]);
  });
});
