import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./ghl-send.js", () => ({ sendConversationMessage: vi.fn() }));

import { LP_ONBOARDING_EMAIL, maybeSendLpOnboarding } from "./lp-onboarding.js";
import { sendConversationMessage } from "./ghl-send.js";

const NOW = Date.parse("2026-07-12T10:00:00-07:00");

function fakeD1() {
  const sends = new Map();
  const events = [];
  const prepare = (sql) => ({
    _args: [],
    bind(...a) { this._args = a; return this; },
    async run() {
      const a = this._args;
      if (/INSERT INTO lp_onboarding_sends/.test(sql)) {
        if (sends.has(a[0])) return { meta: { changes: 0 } };
        sends.set(a[0], { contact_id: a[0], status: a[1], ts: a[2] });
        return { meta: { changes: 1 } };
      }
      if (/INSERT INTO automation_events/.test(sql)) { events.push(a); return { meta: { changes: 1 } }; }
      return { meta: { changes: 0 } };
    },
    async all() { return { results: [] }; },
  });
  return { prepare, _sends: sends, _events: events };
}

let context;
beforeEach(() => {
  context = { env: { AUTOMATION_DB: fakeD1() } };
  vi.clearAllMocks();
});

describe("LP_ONBOARDING_EMAIL — neutral fulfillment copy", () => {
  it("carries the live subject, sender, and portal link", () => {
    expect(LP_ONBOARDING_EMAIL.subject).toBe("Your Living Practice is ready, {{contact.first_name}}");
    expect(LP_ONBOARDING_EMAIL.from).toEqual({ name: "Garrett", email: "garrett@amarimethod.com" });
    expect(LP_ONBOARDING_EMAIL.body).toContain("https://www.amarimethod.com/portal/");
    expect(LP_ONBOARDING_EMAIL.body).toContain("full protocol library with video walkthroughs");
    expect(LP_ONBOARDING_EMAIL.body).not.toMatch(/8-session|\$/i);
  });

  it("never resurrects the retired pre-6/17 body", () => {
    expect(LP_ONBOARDING_EMAIL.body).not.toMatch(/Dr\./);
    expect(LP_ONBOARDING_EMAIL.body).not.toMatch(/exercise library/i);
    expect(LP_ONBOARDING_EMAIL.preheader).not.toMatch(/not just/i);
  });
});

describe("maybeSendLpOnboarding — 8-session clients hitting 2 remaining, once ever", () => {
  const hit = { contactId: "cont_1", seriesType: "8-session", newRemaining: 2 };

  it("fires (shadow: would_send, never sends) when the condition matches", async () => {
    const res = await maybeSendLpOnboarding(context, hit, NOW);
    expect(res.outcome).toBe("would_send");
    expect(sendConversationMessage).not.toHaveBeenCalled();
    const db = context.env.AUTOMATION_DB;
    expect(db._sends.get("cont_1").status).toBe("would_send");
    expect(db._events.some((e) => e[6] === "would_send")).toBe(true);
  });

  it("no-ops for every non-matching transition (the GHL if_else)", async () => {
    for (const args of [
      { contactId: "c", seriesType: "4-session", newRemaining: 2 }, // 4-pack never gets LP onboarding
      { contactId: "c", seriesType: "8-session", newRemaining: 3 },
      { contactId: "c", seriesType: "8-session", newRemaining: 0 },
      { contactId: "c", seriesType: "", newRemaining: 2 },
      { contactId: "c", seriesType: null, newRemaining: 2 },
    ]) {
      const res = await maybeSendLpOnboarding(context, args, NOW);
      expect(res.outcome).toBe("skip");
    }
    expect(context.env.AUTOMATION_DB._sends.size).toBe(0);
  });

  it("sends once per contact — a reconcile correction re-passing through 2 must not re-fire", async () => {
    await maybeSendLpOnboarding(context, hit, NOW);
    const res = await maybeSendLpOnboarding(context, hit, NOW + 3600000);
    expect(res.outcome).toBe("duplicate");
    expect(context.env.AUTOMATION_DB._events.filter((e) => e[6] === "would_send")).toHaveLength(1);
  });

  it("missing AUTOMATION_DB binding: graceful skip; a thrown D1 error is contained", async () => {
    expect((await maybeSendLpOnboarding({ env: {} }, hit, NOW)).outcome).toBe("skip");
    const broken = { prepare: () => { throw new Error("d1 down"); } };
    const res = await maybeSendLpOnboarding({ env: { AUTOMATION_DB: broken } }, hit, NOW);
    expect(res.outcome).toBe("error");
    expect(res.error).toMatch(/d1 down/);
  });
});
