import { describe, expect, it } from "vitest";
import { listFieldPartners, recordFieldVisit } from "./cos-field-visits.js";

class MemoryKv {
  constructor() { this.data = new Map(); }
  async get(key) { return this.data.get(key) || null; }
  async put(key, value) { this.data.set(key, value); }
}

describe("field visit records", () => {
  it("creates a business record, preserves the visit, and merges the next visit", async () => {
    const kv = new MemoryKv();
    const first = await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
      location: "123 Clement St",
      study: "Hand Study",
      flyer_location: "front desk",
      contact: { name: "Maya Lee", role: "manager", email: "maya@example.com" },
      relationship_stage: "host",
      notes: "Happy to hang it.",
      next_visit_on: "2026-08-09",
    });

    const second = await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
      relationship_stage: "workshop_opportunity",
      workshop_signal: true,
      notes: "Asked about staff wrist pain.",
    });

    expect(second.partner.id).toBe(first.partner.id);
    expect(second.partner.visit_count).toBe(2);
    expect(second.partner.relationship_stage).toBe("workshop_opportunity");
    expect(second.partner.next_visit_on).toBeNull();
    expect(second.partner.contact.name).toBe("Maya Lee");

    const partners = await listFieldPartners(kv, "Eben");
    expect(partners).toHaveLength(1);
    expect(partners[0].latest_note).toBe("Asked about staff wrist pain.");
  });

  it("rejects a visit with no business name", async () => {
    await expect(recordFieldVisit(new MemoryKv(), "Eben", { notes: "No name" }))
      .rejects.toThrow("business_name is required");
  });

  it("does not downgrade an established relationship on a routine flyer check", async () => {
    const kv = new MemoryKv();
    await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
      relationship_stage: "workshop_opportunity",
    });
    const record = await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
      relationship_stage: "host",
      notes: "Replaced the flyer.",
    });
    expect(record.partner.relationship_stage).toBe("workshop_opportunity");
  });

  it("keeps branches with the same name as separate partners when addresses differ", async () => {
    const kv = new MemoryKv();
    const first = await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
      location: "123 Clement St",
    });
    const second = await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
      location: "456 Irving St",
    });
    expect(second.partner.id).not.toBe(first.partner.id);
    expect(await listFieldPartners(kv, "Eben")).toHaveLength(2);
  });

  it("orders the revisit queue by scheduled follow-up rather than last touch", async () => {
    const kv = new MemoryKv();
    await recordFieldVisit(kv, "Eben", {
      business_name: "Later",
      next_visit_on: "2026-08-20",
    });
    await recordFieldVisit(kv, "Eben", {
      business_name: "Sooner",
      next_visit_on: "2026-08-01",
    });
    const partners = await listFieldPartners(kv, "Eben");
    expect(partners.map((partner) => partner.business_name)).toEqual(["Sooner", "Later"]);
  });

  it("keeps known contact details when a later capture only adds one field", async () => {
    const kv = new MemoryKv();
    await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
      contact: { name: "Maya Lee", email: "maya@example.com" },
    });
    const record = await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
      contact: { phone: "415-555-0123" },
    });
    expect(record.partner.contact).toEqual({
      name: "Maya Lee",
      role: null,
      phone: "415-555-0123",
      email: "maya@example.com",
    });
  });

  it("keeps confirmed event details on the durable relationship record", async () => {
    const kv = new MemoryKv();
    await recordFieldVisit(kv, "Eben", {
      business_name: "Golden Gate Park Tennis Center",
      relationship_stage: "partner",
      event_on: "2026-09-25",
      event_title: "Tennis-center tabling",
      event_details: "Bring the banner, offer, and table wares.",
    });
    const record = await recordFieldVisit(kv, "Eben", {
      business_name: "Golden Gate Park Tennis Center",
      notes: "Betsy confirmed the table location.",
    });

    expect(record.partner.event_on).toBe("2026-09-25");
    expect(record.partner.event_title).toBe("Tennis-center tabling");
    expect(record.partner.event_details).toBe("Bring the banner, offer, and table wares.");
  });

  it("keeps valid visit photos separate from the compact business record", async () => {
    const kv = new MemoryKv();
    const { visit } = await recordFieldVisit(kv, "Eben", {
      business_name: "Peak Climbing",
    }, ["data:image/jpeg;base64,aGVsbG8="]);

    expect(visit.image_keys).toHaveLength(1);
    expect(await kv.get(visit.image_keys[0])).toBe("data:image/jpeg;base64,aGVsbG8=");
  });
});
