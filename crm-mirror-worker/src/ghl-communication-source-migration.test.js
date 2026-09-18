import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../migrations/0035_ghl_communication_source_archive.sql", import.meta.url), "utf8");

describe("GHL communication source archive migration", () => {
  it("retains raw provider records without requiring an owned contact projection", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS ghl_communication_source_records");
    expect(migration).toContain("provider_event_id TEXT NOT NULL");
    expect(migration).toContain("PRIMARY KEY (provider_event_id, payload_sha256)");
    expect(migration).toContain("payload_json TEXT NOT NULL");
    expect(migration).toContain("payload_sha256 TEXT NOT NULL");
    expect(migration).not.toContain("REFERENCES contacts");
    expect(migration).not.toContain("REFERENCES communication_events");
  });
});
