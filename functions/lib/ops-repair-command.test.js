import { describe, expect, it } from "vitest";
import { claimNextRepairCommand, createRepairCommand, finishRepairCommand, getRepairCommand, policyFor, REPAIR_MODE, REPAIR_POLICIES } from "./ops-repair-command.js";
import { OPS_REGISTRY } from "./ops-registry.js";

function env() {
  const store = new Map();
  return { PORTAL_KV: {
    async put(k, v) { store.set(k, v); },
    async get(k, type) { const v = store.get(k); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  }};
}

describe("ops repair commands", () => {
  it("gives every registered surface an explicit bounded policy", async () => {
    const e = env();
    expect((await createRepairCommand(e, { command: "FIX", pathId: "chief_of_staff" })).ok).toBe(true);
    expect((await createRepairCommand(e, { command: "FIX", pathId: "stripe" })).ok).toBe(true);
    expect(Object.keys(REPAIR_POLICIES).sort()).toEqual(OPS_REGISTRY.map(({ id }) => id).sort());
    expect(policyFor("chief_of_staff").mode).toBe(REPAIR_MODE.REPAIR_DEPLOY);
    expect(policyFor("stripe").mode).toBe(REPAIR_MODE.DIAGNOSE_ONLY);
    expect(policyFor("assessment_paid_book").mode).toBe(REPAIR_MODE.CONFIRM_REQUIRED);
  });
  it("claims once and records a terminal outcome", async () => {
    const e = env();
    const created = await createRepairCommand(e, { command: "FIX", pathId: "field_id_check" });
    const claimed = await claimNextRepairCommand(e, { runnerId: "imac" });
    expect(claimed.command.id).toBe(created.command.id);
    expect((await claimNextRepairCommand(e)).command).toBeNull();
    expect((await finishRepairCommand(e, created.command.id, { status: "completed", result: "verified" })).command.status).toBe("completed");
    expect((await getRepairCommand(e, created.command.id)).command).toMatchObject({ status: "completed", result: "verified" });
  });
  it("keeps CRM repair diagnosis-only", () => expect(policyFor("crm_mirror").mode).toBe(REPAIR_MODE.DIAGNOSE_ONLY));
});
