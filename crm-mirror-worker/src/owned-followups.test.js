import { describe, expect, it } from "vitest";
import {
  createOwnedFollowup,
  listOwnedFollowups,
  setOwnedFollowupCompletion,
} from "./owned-followups.js";

function fakeDb() {
  const contacts = new Map([
    ["contact_1", { id: "contact_1", display_name: "Surrina", external_id: "ghl_contact_1" }],
  ]);
  const followups = new Map();

  return {
    followups,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.includes("FROM contacts contact") && sql.includes("WHERE contact.id = ?")) return contacts.get(values[0]) || null;
              if (sql.includes("FROM owned_followups followup") && sql.includes("WHERE followup.id = ?")) {
                const row = followups.get(values[0]);
                return row ? { ...row, display_name: "Surrina", contact_external_id: "ghl_contact_1" } : null;
              }
              return null;
            },
            async all() {
              if (!sql.includes("FROM owned_followups followup")) return { results: [] };
              const state = values[0];
              const rows = [...followups.values()]
                .filter((row) => state === "all" || (state === "open" ? !row.completed_at : Boolean(row.completed_at)))
                .map((row) => ({ ...row, display_name: "Surrina", contact_external_id: "ghl_contact_1" }));
              return { results: rows };
            },
            async run() {
              if (sql.includes("INSERT INTO owned_followups")) {
                const [id, contactId, title, dueOn, createdBy, now] = values;
                followups.set(id, {
                  id,
                  contact_id: contactId,
                  title,
                  due_on: dueOn,
                  completed_at: null,
                  created_by: createdBy,
                  completed_by: null,
                  created_at: now,
                  updated_at: now,
                });
              } else if (sql.includes("UPDATE owned_followups") && sql.includes("completed_at = ?")) {
                const [completedAt, completedBy, updatedAt, id] = values;
                const row = followups.get(id);
                if (row) followups.set(id, { ...row, completed_at: completedAt, completed_by: completedBy, updated_at: updatedAt });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
}

describe("owned dated follow-ups", () => {
  it("creates a dated follow-up for a mirrored contact and returns it after a reload", async () => {
    const db = fakeDb();
    const created = await createOwnedFollowup(db, {
      contactId: "contact_1",
      title: "Call about the next session",
      dueOn: "2026-08-12",
      actor: "Eben",
    }, "2026-08-08T20:00:00.000Z", "followup_1");

    expect(created).toMatchObject({
      id: "followup_1",
      contactId: "contact_1",
      providerContactId: "ghl_contact_1",
      contactName: "Surrina",
      title: "Call about the next session",
      dueOn: "2026-08-12",
      completedAt: null,
      createdBy: "Eben",
    });
    await expect(listOwnedFollowups(db, { state: "open", limit: 25 })).resolves.toEqual([created]);
  });

  it("completes and reopens the same durable record with staff attribution", async () => {
    const db = fakeDb();
    await createOwnedFollowup(db, {
      contactId: "contact_1",
      title: "Check in",
      dueOn: "2026-08-09",
      actor: "Eben",
    }, "2026-08-08T20:00:00.000Z", "followup_2");

    const completed = await setOwnedFollowupCompletion(db, "followup_2", true, "Garrett", "2026-08-09T17:00:00.000Z");
    expect(completed).toMatchObject({ completedAt: "2026-08-09T17:00:00.000Z", completedBy: "Garrett" });

    const reopened = await setOwnedFollowupCompletion(db, "followup_2", false, "Eben", "2026-08-09T18:00:00.000Z");
    expect(reopened).toMatchObject({ completedAt: null, completedBy: null });
  });

  it("rejects a contact that is not in the owned mirror", async () => {
    await expect(createOwnedFollowup(fakeDb(), {
      contactId: "missing",
      title: "Call",
      dueOn: "2026-08-12",
      actor: "Eben",
    }, "2026-08-08T20:00:00.000Z", "followup_3")).rejects.toThrow("contact is not mirrored");
  });

  it("rejects impossible calendar dates instead of silently normalizing them", async () => {
    await expect(createOwnedFollowup(fakeDb(), {
      contactId: "contact_1",
      title: "Call",
      dueOn: "2026-02-31",
      actor: "Eben",
    }, "2026-08-08T20:00:00.000Z", "followup_4")).rejects.toThrow("valid due date required");
  });
});
