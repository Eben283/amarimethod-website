import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../migrations/0034_communication_attachments.sql", import.meta.url), "utf8");

describe("communication attachment migration", () => {
  it("stores provider locators separately from public timeline fields", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS communication_event_attachments");
    expect(migration).toContain("event_id TEXT NOT NULL REFERENCES communication_events(id) ON DELETE CASCADE");
    expect(migration).toContain("provider_locator TEXT NOT NULL");
    expect(migration).toContain("UNIQUE (event_id, position)");
  });
});
