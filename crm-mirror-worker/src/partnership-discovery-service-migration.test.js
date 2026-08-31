import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

function apply(db, name) {
  const sql = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
  if (name.startsWith("0019_")) db.exec(`BEGIN; ${sql} COMMIT;`);
  else db.exec(sql);
}

describe("Partnership Discovery owned service migration", () => {
  it("adds one exact service identity without changing an existing service", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const names = readdirSync(new URL("../migrations/", import.meta.url))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
    expect(names.at(-1)).toBe("0022_partnership_discovery_service.sql");
    names.slice(0, -1).forEach((name) => apply(db, name));

    const beforeCount = db.prepare("SELECT COUNT(*) AS count FROM services").get().count;
    const existing = db.prepare("SELECT * FROM services WHERE id = 'discovery-call'").get();
    apply(db, names.at(-1));

    expect(db.prepare(`
      SELECT id, name, service_family, duration_minutes, package_eligible,
             provider_calendar_id, active, buffer_minutes, start_interval_minutes
        FROM services WHERE id = 'partnership-discovery'
    `).get()).toEqual({
      id: "partnership-discovery",
      name: "Partnership Discovery Call",
      service_family: "partnership_discovery",
      duration_minutes: 15,
      package_eligible: 0,
      provider_calendar_id: "aVE54Qf4lrbYTB0zFqXy",
      active: 1,
      buffer_minutes: 10,
      start_interval_minutes: 15,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM services").get().count).toBe(beforeCount + 1);
    expect(db.prepare("SELECT * FROM services WHERE id = 'discovery-call'").get()).toEqual(existing);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});
