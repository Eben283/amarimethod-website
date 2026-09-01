import { describe, expect, it } from "vitest";
import {
  addOwnedContactTags,
  readOwnedContactFields,
  readOwnedContactRecipient,
  readOwnedContactTags,
  resolveOwnedNurtureContact,
} from "./owned-contact.js";

function fakeD1({ contacts = [], external = {}, tags = {}, attributes = {} } = {}) {
  const inserted = [];
  return {
    _inserted: inserted,
    prepare(sql) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async all() {
          if (sql.includes("FROM contacts contact")) {
            const reference = this.args[0];
            return { results: contacts.filter((contact) => contact.id === reference || external[reference] === contact.id) };
          }
          if (sql.includes("FROM contact_tags")) {
            return { results: (tags[this.args[0]] || []).map((tag) => ({ tag })) };
          }
          if (sql.includes("FROM contact_attributes")) {
            return { results: attributes[this.args[0]] || [] };
          }
          return { results: [] };
        },
      };
    },
    async batch(statements) {
      return statements.map((statement) => {
        inserted.push(statement.args);
        return { meta: { changes: 1 } };
      });
    },
  };
}

const ada = { id: "owned-1", first_name: " Ada ", email_normalized: "ADA@example.com" };

describe("owned nurture contact adapter", () => {
  it("resolves either the owned ID or a transition provider ID to the same owned person", async () => {
    const db = fakeD1({ contacts: [ada], external: { ghl_1: "owned-1" } });
    expect(await resolveOwnedNurtureContact(db, "owned-1")).toEqual({ id: "owned-1", firstName: "Ada", email: "ada@example.com" });
    expect(await resolveOwnedNurtureContact(db, "ghl_1")).toEqual({ id: "owned-1", firstName: "Ada", email: "ada@example.com" });
  });

  it("fails closed for missing or ambiguous identity", async () => {
    await expect(resolveOwnedNurtureContact(fakeD1(), "missing")).rejects.toThrow("not found");
    const db = fakeD1({
      contacts: [ada, { ...ada, id: "owned-2" }],
      external: { duplicate: "owned-1" },
    });
    db.prepare = () => ({ bind() { return this; }, async all() { return { results: [ada, { ...ada, id: "owned-2" }] }; } });
    await expect(resolveOwnedNurtureContact(db, "duplicate")).rejects.toThrow("ambiguous");
  });

  it("reads guards and maps the legacy provider attribute to the native branch key", async () => {
    const db = fakeD1({
      contacts: [ada],
      tags: { "owned-1": ["affiliate-partner", "quiz submitted"] },
      attributes: {
        "owned-1": [{ source: "ghl", attribute_key: "vKZTVAG7601lgV8413du", attribute_value: "Hips" }],
      },
    });
    expect(await readOwnedContactTags(db, "owned-1")).toEqual(["affiliate-partner", "quiz submitted"]);
    expect(await readOwnedContactFields(db, "owned-1")).toEqual({ primaryPainLocation: "Hips" });
  });

  it("requires a deliverable owned recipient and writes native tags idempotently", async () => {
    const db = fakeD1({ contacts: [ada] });
    expect(await readOwnedContactRecipient(db, "owned-1")).toEqual({ id: "owned-1", firstName: "Ada", email: "ada@example.com" });
    expect(await addOwnedContactTags(db, "owned-1", ["workflow 3", "workflow 3"], 1_788_000_000_000)).toEqual({ contactId: "owned-1", added: 1 });
    expect(db._inserted[0]).toEqual(["owned-1", "workflow 3", "2026-08-29T10:40:00.000Z"]);
    await expect(readOwnedContactRecipient(fakeD1({ contacts: [{ ...ada, email_normalized: null }] }), "owned-1"))
      .rejects.toThrow("email is missing or invalid");
  });
});
