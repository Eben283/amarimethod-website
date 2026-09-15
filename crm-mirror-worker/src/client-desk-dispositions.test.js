import { describe, expect, it } from "vitest";
import { ClientDeskDispositionError, setClientDeskDisposition } from "./client-desk-dispositions.js";

function fixture(latestEventAt = "2026-09-15T12:00:00.000Z") {
  const writes = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            first: async () => latestEventAt ? ({ thread_id: "thread-1", last_event_at: latestEventAt }) : null,
            run: async () => { writes.push({ sql, values }); return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
  return { db, writes };
}

describe("Client Desk conversation dispositions", () => {
  it.each(["done", "spam"])("anchors %s to the latest event so later inbound work reopens", async (state) => {
    const { db, writes } = fixture();
    await expect(setClientDeskDisposition(db, { contactId: "contact-1", state, actor: "Eben", now: "2026-09-15T12:01:00.000Z" }))
      .resolves.toEqual({ state, resolvedThreadId: "thread-1", resolvedEventAt: "2026-09-15T12:00:00.000Z" });
    expect(writes[0].sql).toContain("client_desk_conversation_dispositions");
    expect(writes[0].values).toEqual(["contact-1", state, "thread-1", "2026-09-15T12:00:00.000Z", "Eben", "2026-09-15T12:01:00.000Z"]);
  });

  it("reopens by deleting only the owned disposition", async () => {
    const { db, writes } = fixture();
    await expect(setClientDeskDisposition(db, { contactId: "contact-1", state: "open", actor: "Eben", now: "2026-09-15T12:01:00.000Z" }))
      .resolves.toEqual({ state: "open", resolvedEventAt: null });
    expect(writes[0].sql).toContain("DELETE FROM client_desk_conversation_dispositions");
    expect(writes[0].values).toEqual(["contact-1"]);
  });

  it("rejects unsupported states and conversations without an event", async () => {
    const { db } = fixture(null);
    await expect(setClientDeskDisposition(db, { contactId: "contact-1", state: "archive", actor: "Eben", now: "2026-09-15T12:01:00.000Z" }))
      .rejects.toMatchObject({ code: "invalid_disposition" });
    await expect(setClientDeskDisposition(db, { contactId: "contact-1", state: "done", actor: "Eben", now: "2026-09-15T12:01:00.000Z" }))
      .rejects.toBeInstanceOf(ClientDeskDispositionError);
  });
});
