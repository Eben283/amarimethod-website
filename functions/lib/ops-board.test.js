import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ops-events.js", () => ({
  countOpenIncidentsByPath: vi.fn(async () => ({})),
  listOpsIncidents: vi.fn(async () => []),
  listOpsEvents: vi.fn(async () => []),
}));

vi.mock("./ops-alert.js", () => ({
  listOpsErrors: vi.fn(async () => []),
}));

vi.mock("./ops-trail-kv.js", () => ({
  trailMeta: vi.fn(async () => null),
}));

import { buildSystemsBoard, buildPathDetail, buildPersonTimeline } from "./ops-board.js";
import {
  countOpenIncidentsByPath,
  listOpsIncidents,
  listOpsEvents,
} from "./ops-events.js";
import { listOpsErrors } from "./ops-alert.js";
import { PATH_ASSESSMENT_PAID_BOOK } from "./ops-registry.js";
import { OPS_BOARD_ROLE, OPS_ROW_STATE, boardMetaFor } from "./ops-board-meta.js";

beforeEach(() => {
  vi.clearAllMocks();
  listOpsEvents.mockResolvedValue([]);
  listOpsErrors.mockResolvedValue([]);
  listOpsIncidents.mockResolvedValue([]);
});

function kvEnv(map = {}) {
  return {
    PORTAL_KV: {
      async get(key, type) {
        const v = map[key];
        if (v == null) return null;
        if (type === "json") return typeof v === "string" ? JSON.parse(v) : v;
        return String(v);
      },
    },
  };
}

describe("ops-board-meta", () => {
  it("marks money paths hot and partner welcome quiet", () => {
    expect(boardMetaFor(PATH_ASSESSMENT_PAID_BOOK).role).toBe(OPS_BOARD_ROLE.HOT);
    expect(boardMetaFor("partner_welcome_message").role).toBe(OPS_BOARD_ROLE.QUIET);
    expect(boardMetaFor("ghl_token").role).toBe(OPS_BOARD_ROLE.MAP);
    expect(boardMetaFor(PATH_ASSESSMENT_PAID_BOOK).changeSurface.touch).toMatch(/appointment/i);
  });
});

describe("buildSystemsBoard", () => {
  it("marks assessment sick/red when an open incident exists; paths before deps", async () => {
    countOpenIncidentsByPath.mockResolvedValue({ [PATH_ASSESSMENT_PAID_BOOK]: 1 });
    const board = await buildSystemsBoard({ AUTOMATION_DB: {}, ...kvEnv() });
    expect(board.overall).toBe("red");
    expect(board.attentionCount).toBeGreaterThan(0);
    const assessment = board.systems.find((s) => s.id === PATH_ASSESSMENT_PAID_BOOK);
    expect(assessment.status).toBe("red");
    expect(assessment.state).toMatch(/sick|stuck/);
    expect(assessment.boardRole).toBe(OPS_BOARD_ROLE.HOT);
    expect(assessment.autoFix).toBe(true);
    expect(board.fixMode).toBe("shadow");
    expect(board.hotStrip).toBeTruthy();
    expect(board.systems[0].group).toBe("paths");
  });

  it("does not fake-green assessment with empty trail", async () => {
    countOpenIncidentsByPath.mockResolvedValue({});
    const board = await buildSystemsBoard({ AUTOMATION_DB: {}, ...kvEnv() });
    const assessment = board.systems.find((s) => s.id === PATH_ASSESSMENT_PAID_BOOK);
    expect(assessment.status).toBe("unknown");
    expect(assessment.state).toBe(OPS_ROW_STATE.IDLE);
    expect(assessment.note).toMatch(/no trail/i);
  });

  it("marks partial/planned paths idle or blind, never green", async () => {
    const board = await buildSystemsBoard({ AUTOMATION_DB: {}, ...kvEnv() });
    const intro = board.systems.find((s) => s.id === "intro_paid_book");
    // intro is now full instrumentation — idle without trail
    expect(intro.status).toBe("unknown");
    expect(intro.state).toBe(OPS_ROW_STATE.IDLE);
    const welcome = board.systems.find((s) => s.id === "partner_welcome_message");
    expect(welcome.state).toBe(OPS_ROW_STATE.IDLE);
    expect(welcome.boardRole).toBe(OPS_BOARD_ROLE.QUIET);
  });

  it("marks invoice credit red/stuck from latest fail trail event", async () => {
    listOpsEvents.mockImplementation(async (_env, { pathId } = {}) => {
      if (pathId === "invoice_package_credit") {
        return [
          {
            pathId: "invoice_package_credit",
            hopId: "put_session_fields",
            outcome: "fail",
            summary: "PUT sessions failed",
            at: new Date().toISOString(),
          },
        ];
      }
      return [];
    });
    const board = await buildSystemsBoard(kvEnv());
    const invoice = board.systems.find((s) => s.id === "invoice_package_credit");
    expect(invoice.status).toBe("red");
    expect(invoice.state).toBe(OPS_ROW_STATE.SICK);
    expect(invoice.note).toMatch(/failed|PUT/i);
  });

  it("still paints partial-era ops:err onto invoice via related source map", async () => {
    listOpsErrors.mockResolvedValue([
      {
        key: "ops:err:1",
        source: "ghl-invoice-webhook",
        summary: "PUT sessions failed",
        at: new Date().toISOString(),
      },
    ]);
    // Full paths ignore ops:err for home status — but source map remains for detail.
    const board = await buildSystemsBoard(kvEnv());
    expect(board.systems.find((s) => s.id === "invoice_package_credit").instrumentation).toBe(
      "full",
    );
  });

  it("registers expanded money/booking/messaging/infra rows", async () => {
    const board = await buildSystemsBoard(kvEnv());
    const ids = board.systems.map((s) => s.id);
    for (const id of [
      "invoice_package_credit",
      "order_package_credit",
      "discovery_free_book",
      "portal_package_book",
      "appointment_webhook",
      "comms_coherence",
      "reminder_engine",
      "conversation_cache",
      "funnel_refresh",
      "call_coach",
      "ledger_drift",
      "field_id_check",
      "chief_of_staff",
      "morning_sms",
      "staff_auth",
      "portal_auth",
      "public_slots",
      "stripe",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("surfaces CoS readiness, morning SMS, slots, Stripe, and auth heartbeats", async () => {
    const board = await buildSystemsBoard(
      kvEnv({
        "cos:status:ready": {
          ok: true,
          checkedAt: new Date().toISOString(),
          provider: "openrouter",
        },
        "ops:cos-auth:lastRun": {
          status: "ok",
          user: "Eben",
          finishedAt: new Date().toISOString(),
        },
        "ops:morning-sms:lastRun": {
          status: "ok",
          mode: "active",
          sendCount: 2,
          finishedAt: new Date().toISOString(),
          schedule: { reason: "default_8am" },
        },
        "ops:staff-auth:lastRun": {
          status: "ok",
          user: "Garrett",
          finishedAt: new Date().toISOString(),
        },
        "ops:portal-auth:lastRun": {
          status: "ok",
          finishedAt: new Date().toISOString(),
        },
        "ops:public-slots:lastRun": {
          status: "ok",
          calendarId: "EM6vB2mq7EAdGCbUb3j1",
          slotCount: 12,
          finishedAt: new Date().toISOString(),
        },
        "stripe:status:ready": {
          ok: true,
          checkedAt: new Date().toISOString(),
        },
      }),
    );
    expect(board.systems.find((s) => s.id === "chief_of_staff").status).toBe("green");
    expect(board.systems.find((s) => s.id === "morning_sms").status).toBe("green");
    expect(board.systems.find((s) => s.id === "staff_auth").status).toBe("green");
    expect(board.systems.find((s) => s.id === "portal_auth").status).toBe("green");
    expect(board.systems.find((s) => s.id === "public_slots").status).toBe("green");
    expect(board.systems.find((s) => s.id === "stripe").status).toBe("green");
  });

  it("marks CoS red when OpenRouter readiness fails", async () => {
    const board = await buildSystemsBoard(
      kvEnv({
        "cos:status:ready": {
          ok: false,
          checkedAt: new Date().toISOString(),
          error: "OPENROUTER_API_KEY not configured",
        },
      }),
    );
    const cos = board.systems.find((s) => s.id === "chief_of_staff");
    expect(cos.status).toBe("red");
    expect(cos.note).toMatch(/OPENROUTER|not configured/i);
  });

  it("does not leave stale interactive successes green indefinitely", async () => {
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const board = await buildSystemsBoard(kvEnv({
      "cos:status:ready": { ok: true, checkedAt: old },
      "ops:staff-auth:lastRun": { status: "ok", finishedAt: old },
      "ops:portal-auth:lastRun": { status: "ok", finishedAt: old },
    }));

    const cos = board.systems.find((system) => system.id === "chief_of_staff");
    const staff = board.systems.find((system) => system.id === "staff_auth");
    const portal = board.systems.find((system) => system.id === "portal_auth");
    expect(cos.status).toBe("unknown");
    expect(cos.note).toMatch(/stale/i);
    expect(staff.status).toBe("unknown");
    expect(staff.note).toMatch(/stale/i);
    expect(portal.status).toBe("unknown");
    expect(portal.note).toMatch(/stale/i);
  });

  it("surfaces live GHL token + reconcile + funnel signals as map_ok", async () => {
    const expiry = String(Date.now() + 20 * 3600 * 1000);
    const board = await buildSystemsBoard(
      kvEnv({
        ghl_token_expiry: expiry,
        "ops:series-reconcile:lastRun": {
          status: "ok",
          finishedAt: new Date().toISOString(),
          applied: 0,
          ordersScanned: 7,
        },
        "ops:funnel-refresh:lastRun": {
          status: "ok",
          finishedAt: new Date().toISOString(),
          sales: 3,
          sessionsSold: 8,
        },
      }),
    );
    expect(board.systems.find((s) => s.id === "ghl_token").status).toBe("green");
    expect(board.systems.find((s) => s.id === "ghl_token").state).toBe(OPS_ROW_STATE.MAP_OK);
    expect(board.systems.find((s) => s.id === "series_reconcile").status).toBe("green");
    expect(board.systems.find((s) => s.id === "funnel_refresh").status).toBe("green");
  });

  it("call coach is green on fresh readiness even with no coaching run", async () => {
    const board = await buildSystemsBoard(
      kvEnv({
        "call-coach:status:ready": {
          ok: true,
          checkedAt: new Date().toISOString(),
          openRouter: true,
          ghlTokenOk: true,
          model: "google/gemini-2.5-flash-lite",
        },
      }),
    );
    const coach = board.systems.find((s) => s.id === "call_coach");
    expect(coach.status).toBe("green");
    expect(coach.state).toBe(OPS_ROW_STATE.MAP_OK);
    expect(coach.note).toMatch(/ready · on-demand/i);
    expect(coach.label).toMatch(/on-demand/i);
  });

  it("call coach is red when readiness says not ready", async () => {
    const board = await buildSystemsBoard(
      kvEnv({
        "call-coach:status:ready": {
          ok: false,
          checkedAt: new Date().toISOString(),
          error: "OPENROUTER_API_KEY not configured",
        },
      }),
    );
    const coach = board.systems.find((s) => s.id === "call_coach");
    expect(coach.status).toBe("red");
    expect(coach.state).toBe(OPS_ROW_STATE.MAP_BAD);
    expect(coach.note).toMatch(/not ready/i);
  });

  it("surfaces reminder + nurture + crm lastRuns", async () => {
    const board = await buildSystemsBoard(
      kvEnv({
        "ops:reminder-engine:lastRun": {
          status: "ok",
          finishedAt: new Date().toISOString(),
          due: 1,
          would_send: 1,
        },
        "ops:nurture-engine:lastRun": {
          status: "ok",
          finishedAt: new Date().toISOString(),
          due: 0,
        },
        "ops:crm-mirror:lastRun": {
          status: "ok",
          ok: true,
          finishedAt: new Date().toISOString(),
        },
      }),
    );
    expect(board.systems.find((s) => s.id === "reminder_engine").status).toBe("green");
    expect(board.systems.find((s) => s.id === "nurture_engine").status).toBe("green");
    expect(board.systems.find((s) => s.id === "crm_mirror").status).toBe("green");
  });

  it("surfaces external GitHub and monitor heartbeats on their Operations rows", async () => {
    listOpsEvents.mockImplementation(async (_env, { pathId } = {}) => {
      if (pathId === "github_actions") {
        return [{
          id: "evt_github",
          at: new Date().toISOString(),
          pathId,
          hopId: "synthetic_monitor",
          outcome: "fail",
          reasonCode: "monitor_failed",
          summary: "GitHub Actions day-write failed",
          condition: { expected: "green synthetic health check", observed: "red" },
          source: "amari-cloud-health",
          personLabel: "must not leak",
          contactId: "must-not-leak",
        }];
      }
      if (pathId === "ops_monitor") {
        return [{
          id: "evt_monitor",
          at: new Date().toISOString(),
          pathId,
          hopId: "synthetic_monitor",
          outcome: "ok",
          reasonCode: "monitor_recovered",
          summary: "All registered critical paths checked",
          condition: { expected: "green synthetic health check", observed: "green" },
          source: "amari-cloud-health",
        }];
      }
      if (pathId === "outreach_snapshot") {
        return [{
          id: "evt_outreach",
          at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
          pathId,
          hopId: "synthetic_monitor",
          outcome: "ok",
          reasonCode: "monitor_recovered",
          summary: "Outreach snapshot is current",
          condition: { expected: "green synthetic health check", observed: "green" },
          source: "amari-cloud-health",
        }];
      }
      return [];
    });

    const board = await buildSystemsBoard(kvEnv());
    const github = board.systems.find((s) => s.id === "github_actions");
    const monitor = board.systems.find((s) => s.id === "ops_monitor");
    expect(github.status).toBe("red");
    expect(github.state).toBe(OPS_ROW_STATE.MAP_BAD);
    expect(github.note).toMatch(/day-write failed/i);
    expect(monitor.status).toBe("green");
    expect(monitor.state).toBe(OPS_ROW_STATE.MAP_OK);
    expect(board.systems.find((s) => s.id === "outreach_snapshot").status).toBe("green");
  });

  it("lets an external failure override a green native dependency signal", async () => {
    listOpsEvents.mockImplementation(async (_env, { pathId } = {}) => pathId === "chief_of_staff"
      ? [{
          id: "evt_cos_failed",
          at: new Date().toISOString(),
          pathId,
          hopId: "synthetic_monitor",
          outcome: "fail",
          reasonCode: "monitor_failed",
          summary: "Google Calendar readiness probe failed",
          condition: { expected: "green synthetic health check", observed: "red" },
          source: "amari-cloud-health",
        }]
      : []);
    const board = await buildSystemsBoard(kvEnv({
      "cos:status:ready": {
        ok: true,
        checkedAt: new Date().toISOString(),
        provider: "openrouter",
      },
    }));
    const cos = board.systems.find((s) => s.id === "chief_of_staff");
    expect(cos.status).toBe("red");
    expect(cos.state).toBe(OPS_ROW_STATE.MAP_BAD);
    expect(cos.note).toMatch(/Calendar readiness probe failed/i);
  });

  it("turns stale external monitor heartbeats red", async () => {
    listOpsEvents.mockImplementation(async (_env, { pathId } = {}) => {
      if (pathId !== "ops_monitor") return [];
      return [{
        id: "evt_stale_monitor",
        at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        pathId,
        hopId: "synthetic_monitor",
        outcome: "ok",
        reasonCode: "monitor_recovered",
        summary: "All registered critical paths checked",
        condition: { expected: "green synthetic health check", observed: "green" },
        source: "amari-cloud-health",
      }];
    });

    const board = await buildSystemsBoard(kvEnv());
    const monitor = board.systems.find((s) => s.id === "ops_monitor");
    expect(monitor.status).toBe("red");
    expect(monitor.state).toBe(OPS_ROW_STATE.MAP_BAD);
    expect(monitor.note).toMatch(/stale/i);
  });

  it("uses the newest external monitor transition after recovery", async () => {
    const recoveredAt = new Date().toISOString();
    listOpsEvents.mockImplementation(async (_env, { pathId } = {}) => pathId === "github_actions"
      ? [
          {
            id: "evt_recovered",
            at: recoveredAt,
            pathId,
            hopId: "synthetic_monitor",
            outcome: "ok",
            reasonCode: "monitor_recovered",
            summary: "Latest day-write run succeeded",
            condition: { expected: "green synthetic health check", observed: "green" },
            source: "amari-cloud-health",
          },
          {
            id: "evt_failed",
            at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
            pathId,
            hopId: "synthetic_monitor",
            outcome: "fail",
            reasonCode: "monitor_failed",
            summary: "Earlier day-write run failed",
            condition: { expected: "green synthetic health check", observed: "red" },
            source: "amari-cloud-health",
          },
        ]
      : []);

    const board = await buildSystemsBoard(kvEnv());
    const github = board.systems.find((s) => s.id === "github_actions");
    expect(github.status).toBe("green");
    expect(github.state).toBe(OPS_ROW_STATE.MAP_OK);
    expect(github.note).toMatch(/succeeded/i);
    expect(github.lastAt).toBe(recoveredAt);
  });

  it("does not paint a dependency green while its incident remains open", async () => {
    countOpenIncidentsByPath.mockResolvedValue({ github_actions: 1 });
    const board = await buildSystemsBoard(kvEnv());
    const github = board.systems.find((s) => s.id === "github_actions");
    expect(github.status).toBe("red");
    expect(github.state).toBe(OPS_ROW_STATE.MAP_BAD);
    expect(github.note).toMatch(/1 open incident/i);
  });

  it("marks newly full money/booking paths as full instrumentation", async () => {
    const board = await buildSystemsBoard(kvEnv());
    for (const id of [
      "intro_paid_book",
      "order_package_credit",
      "invoice_package_credit",
      "pos_card_fulfill",
      "discovery_free_book",
      "portal_package_book",
      "staff_book",
      "portal_followup_paid_book",
      "appointment_webhook",
    ]) {
      expect(board.systems.find((s) => s.id === id).instrumentation).toBe("full");
    }
    expect(board.systems.find((s) => s.id === "partner_welcome_message").instrumentation).toBe(
      "planned",
    );
  });

  it("hotStrip lists stuck paid→book and people from open incidents", async () => {
    countOpenIncidentsByPath.mockResolvedValue({ [PATH_ASSESSMENT_PAID_BOOK]: 1 });
    listOpsEvents.mockImplementation(async (_env, { pathId } = {}) => {
      if (pathId === PATH_ASSESSMENT_PAID_BOOK) {
        return [
          {
            pathId: PATH_ASSESSMENT_PAID_BOOK,
            hopId: "create_appointment",
            outcome: "fail",
            summary: "slot on contact, no appointment",
            at: new Date().toISOString(),
            reasonCode: "stuck_hop",
          },
        ];
      }
      return [];
    });
    listOpsIncidents.mockResolvedValue([
      {
        pathId: "github_actions",
        correlationId: "monitor:github_actions",
        title: "GitHub Actions monitor red",
        failedHopId: "synthetic_monitor",
      },
      {
        pathId: PATH_ASSESSMENT_PAID_BOOK,
        personLabel: "Holly Brinkman",
        contactId: "c_holly",
        title: "Paid Assessment, no appointment",
        failedHopId: "create_appointment",
      },
    ]);
    const board = await buildSystemsBoard({ AUTOMATION_DB: {}, ...kvEnv() });
    expect(board.hotStrip.tone).toBe("stuck");
    expect(board.hotStrip.paidToBook).toBe("stuck");
    expect(board.hotStrip.people[0].personLabel).toBe("Holly Brinkman");
    expect(board.hotStrip.people).toHaveLength(1);
    expect(board.hotStrip.people.some((person) => person.correlationId?.startsWith("monitor:"))).toBe(false);
    const assessment = board.systems.find((s) => s.id === PATH_ASSESSMENT_PAID_BOOK);
    expect(assessment.state).toBe(OPS_ROW_STATE.STUCK);
  });
});

describe("buildPathDetail", () => {
  it("returns null for unknown path", async () => {
    expect(await buildPathDetail({}, "nope")).toBeNull();
  });

  it("highlights stuck hop, people, and change surface", async () => {
    listOpsIncidents.mockResolvedValue([
      {
        id: "inc_1",
        title: "Paid Assessment, no appointment",
        failedHopId: "create_appointment",
        personLabel: "Holly Brinkman",
        contactId: "c_holly",
      },
    ]);
    listOpsEvents.mockResolvedValue([
      {
        hopId: "create_appointment",
        outcome: "fail",
        summary: "no book",
        at: "2026-07-29T12:00:00.000Z",
        condition: { expected: "slot iso", observed: "null" },
        contactId: "c_holly",
        personLabel: "Holly Brinkman",
      },
      {
        hopId: "purchase_webhook",
        outcome: "ok",
        summary: "paid",
        at: "2026-07-29T11:59:00.000Z",
        contactId: "c_holly",
        personLabel: "Holly Brinkman",
      },
    ]);
    const detail = await buildPathDetail({ AUTOMATION_DB: {} }, PATH_ASSESSMENT_PAID_BOOK);
    expect(detail.status).toBe("red");
    expect(detail.state).toMatch(/sick|stuck/);
    const bookHop = detail.hops.find((h) => h.id === "create_appointment");
    expect(bookHop.state).toBe("stuck");
    expect(detail.people[0].personLabel).toBe("Holly Brinkman");
    expect(detail.changeSurface.touch).toMatch(/appointment/i);
    expect(detail.events).toHaveLength(2);
    expect(detail.incidents[0].personLabel).toBe("Holly Brinkman");
  });

  it("dependency detail exposes why from KV signal", async () => {
    const expiry = String(Date.now() + 12 * 3600 * 1000);
    const detail = await buildPathDetail(kvEnv({ ghl_token_expiry: expiry }), "ghl_token");
    expect(detail.status).toBe("green");
    expect(detail.state).toBe(OPS_ROW_STATE.MAP_OK);
    expect(detail.why).toMatch(/remaining/i);
    expect(detail.events.length).toBeGreaterThan(0);
  });

  it("dependency detail exposes a sanitized external monitor event", async () => {
    listOpsIncidents.mockResolvedValue([{
      id: "inc_github",
      pathId: "github_actions",
      status: "open",
      correlationId: "monitor:github_actions",
      title: "GitHub Actions monitor red",
    }]);
    listOpsEvents.mockImplementation(async (_env, { pathId } = {}) => pathId === "github_actions"
      ? [{
          id: "evt_github",
          at: new Date().toISOString(),
          pathId,
          hopId: "synthetic_monitor",
          outcome: "fail",
          reasonCode: "monitor_failed",
          summary: "GitHub Actions day-write failed",
          condition: { expected: "green synthetic health check", observed: "red" },
          source: "amari-cloud-health",
          personLabel: "must not leak",
          contactId: "must-not-leak",
          message: { body: "must not leak" },
        }]
      : []);

    const detail = await buildPathDetail(kvEnv(), "github_actions");
    expect(detail.status).toBe("red");
    expect(detail.events).toHaveLength(1);
    expect(detail.incidents).toHaveLength(1);
    expect(detail.events[0].summary).toMatch(/day-write failed/i);
    expect(detail.events[0]).not.toHaveProperty("personLabel");
    expect(detail.events[0]).not.toHaveProperty("contactId");
    expect(detail.events[0]).not.toHaveProperty("message");
  });
});

describe("buildPersonTimeline", () => {
  it("returns null without path or person key", async () => {
    expect(await buildPersonTimeline({}, { pathId: PATH_ASSESSMENT_PAID_BOOK })).toBeNull();
    expect(await buildPersonTimeline({}, { contactId: "c1" })).toBeNull();
  });

  it("shapes Holly stuck paid→book timeline", async () => {
    listOpsEvents.mockResolvedValue([
      {
        hopId: "create_appointment",
        outcome: "fail",
        summary: "slot present, appointment create never ran",
        at: "2026-07-29T12:00:00.000Z",
        condition: { expected: "appointment id", observed: "null" },
        contactId: "c_holly",
        personLabel: "Holly Brinkman",
        reasonCode: "stuck_hop",
      },
      {
        hopId: "purchase_webhook",
        outcome: "ok",
        summary: "Assessment paid",
        at: "2026-07-29T11:59:00.000Z",
        contactId: "c_holly",
        personLabel: "Holly Brinkman",
      },
      {
        hopId: "create_checkout",
        outcome: "ok",
        summary: "Checkout created with slot",
        at: "2026-07-29T11:58:00.000Z",
        contactId: "c_holly",
        personLabel: "Holly Brinkman",
      },
    ]);
    listOpsIncidents.mockResolvedValue([
      {
        personLabel: "Holly Brinkman",
        contactId: "c_holly",
        failedHopId: "create_appointment",
        title: "Paid Assessment, no appointment",
      },
    ]);
    const person = await buildPersonTimeline(
      { AUTOMATION_DB: {} },
      { pathId: PATH_ASSESSMENT_PAID_BOOK, contactId: "c_holly" },
    );
    expect(person.view).toBe("person");
    expect(person.personLabel).toBe("Holly Brinkman");
    expect(person.pill).toBe("stuck hop");
    expect(person.site.some((h) => h.hopId === "create_checkout")).toBe(true);
    expect(person.automation.some((h) => h.status === "stuck")).toBe(true);
    expect(person.why).toMatch(/stuck|paid/i);
    expect(person.nextIfUnchanged).toMatch(/confirmation/i);
    expect(person.changeSurface.talkHint).toMatch(/Assessment/i);
  });

  it("shapes Sean welcome collision as quiet messaging person", async () => {
    listOpsEvents.mockResolvedValue([
      {
        hopId: "send_welcome",
        outcome: "fail",
        summary: "Welcome said please book after Partner Initial already booked",
        at: "2026-07-28T17:18:00.000Z",
        contactId: "c_sean",
        personLabel: "Sean O'Donoghue",
        reasonCode: "collision",
      },
    ]);
    const person = await buildPersonTimeline(
      { AUTOMATION_DB: {} },
      { pathId: "partner_welcome_message", contactId: "c_sean" },
    );
    expect(person.personLabel).toMatch(/Sean/);
    expect(person.pill).toBe("collision");
    expect(person.why).toMatch(/already booked/i);
    expect(person.changeSurface.talkHint).toMatch(/Sean|welcome/i);
  });
});
