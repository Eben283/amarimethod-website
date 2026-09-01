import { describe, expect, it } from "vitest";
import { ownedContactAliases } from "./owned-contact-identity.js";

function crm(rows) {
  return {
    prepare() {
      return {
        bind() { return this; },
        async all() { return { results: rows }; },
      };
    },
  };
}

const ownedEvent = (over = {}) => ({
  contactId: "owned-contact",
  context: {
    source: "owned_crm",
    ownedContactId: "owned-contact",
    provider: "google_calendar",
    providerContactId: null,
  },
  ...over,
});

describe("owned Reminder contact aliases", () => {
  it("leaves an ordinary provider webhook scoped to its exact contact id", async () => {
    await expect(ownedContactAliases({}, { contactId: "ghl-contact" }))
      .resolves.toEqual(["ghl-contact"]);
  });

  it("bridges an owned Google rebooking to its one exact legacy GHL alias", async () => {
    await expect(ownedContactAliases({ CRM_DB: crm([{
      owned_contact_id: "owned-contact", ghl_contact_id: "ghl-contact",
    }]) }, ownedEvent())).resolves.toEqual(["owned-contact", "ghl-contact"]);
  });

  it("proves both identities on an owned GHL event", async () => {
    const event = ownedEvent({
      contactId: "ghl-contact",
      context: {
        source: "owned_crm", ownedContactId: "owned-contact",
        provider: "ghl", providerContactId: "ghl-contact",
      },
    });
    await expect(ownedContactAliases({ CRM_DB: crm([{
      owned_contact_id: "owned-contact", ghl_contact_id: "ghl-contact",
    }]) }, event)).resolves.toEqual(["ghl-contact", "owned-contact"]);
  });

  it("fails closed on an unavailable, ambiguous, or contradictory crosswalk", async () => {
    await expect(ownedContactAliases({}, ownedEvent())).rejects.toMatchObject({
      code: "owned_contact_crosswalk_unavailable",
    });
    await expect(ownedContactAliases({ CRM_DB: crm([
      { owned_contact_id: "owned-contact", ghl_contact_id: "ghl-a" },
      { owned_contact_id: "owned-contact", ghl_contact_id: "ghl-b" },
    ]) }, ownedEvent())).rejects.toMatchObject({ code: "owned_contact_alias_ambiguous" });
    await expect(ownedContactAliases({ CRM_DB: crm([{
      owned_contact_id: "owned-contact", ghl_contact_id: "ghl-contact",
    }]) }, ownedEvent({ contactId: "different-owned-contact" }))).rejects.toMatchObject({
      code: "owned_contact_alias_mismatch",
    });
  });
});
