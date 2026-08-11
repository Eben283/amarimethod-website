import { describe, expect, it } from "vitest";
import { INITIAL_IN_PERSON_WORKFLOW } from "./initial-in-person-workflow.js";
import { INITIAL_VIRTUAL_WORKFLOW } from "./initial-virtual-workflow.js";
import { ensurePublishedWorkflow, publishBundledWorkflow, publishedWorkflow, saveDraftWorkflow, publishDraftWorkflow, workflowVersion } from "./workflow-store.js";

function fakeD1() {
  const rows = [];
  function statement(sql) {
    return {
      args: [], bind(...args) { this.args = args; return this; },
      async first() {
        const [id, version] = this.args;
        let found = rows.find((row) => row.workflow_id === id && (version == null || row.version === version));
        if (sql.includes("state = 'published'")) found = rows.find((row) => row.workflow_id === id && row.state === "published");
        if (sql.includes("state = 'draft'")) found = rows.find((row) => row.workflow_id === id && row.version === version && row.state === "draft");
        if (!found) return null;
        if (/SELECT version /.test(sql)) return { version: found.version };
        return { document: found.document };
      },
      async run() {
        const a = this.args;
        if (sql.includes("INSERT INTO workflow_versions")) {
          const [workflow_id, version, document, created_at, published_at] = a;
          const state = sql.includes("'published'") ? "published" : "draft";
          const existing = rows.find((row) => row.workflow_id === workflow_id && row.version === version);
          if (existing && existing.state === "draft") Object.assign(existing, { document, created_at });
          else if (!existing) rows.push({ workflow_id, version, state, document, created_at, published_at });
        }
        if (sql.startsWith("UPDATE workflow_versions SET state = 'retired'")) {
          for (const row of rows) if (row.workflow_id === a[0] && row.state === "published") row.state = "retired";
        }
        if (sql.startsWith("UPDATE workflow_versions SET state = 'published'")) {
          const [published_at, workflow_id, version] = a;
          const row = rows.find((item) => item.workflow_id === workflow_id && item.version === version && item.state === "draft");
          if (row) Object.assign(row, { state: "published", published_at });
        }
        return { meta: { changes: 1 } };
      },
    };
  }
  return { prepare: statement, batch: async (statements) => Promise.all(statements.map((item) => item.run())), rows };
}

describe("workflow version store", () => {
  it("seeds the shipped document as the first published truth", async () => {
    const db = fakeD1();
    expect(await ensurePublishedWorkflow(db, INITIAL_IN_PERSON_WORKFLOW, 100)).toEqual(INITIAL_IN_PERSON_WORKFLOW);
    expect(db.rows).toMatchObject([{ workflow_id: "initial-in-person", version: 3, state: "published" }]);
    const olderBundledCopy = { ...INITIAL_IN_PERSON_WORKFLOW, version: 2, name: "Accidental rollback" };
    expect((await ensurePublishedWorkflow(db, olderBundledCopy, 200)).version).toBe(3);
    expect(db.rows).toHaveLength(1);
  });

  it("keeps a draft inert and publishes only against the expected current version", async () => {
    const db = fakeD1();
    await ensurePublishedWorkflow(db, INITIAL_IN_PERSON_WORKFLOW, 100);
    const draft = { ...INITIAL_IN_PERSON_WORKFLOW, version: 4, name: "Edited but inert" };
    await saveDraftWorkflow(db, draft, 200);
    expect((await workflowVersion(db, draft.id, 4)).name).toBe("Edited but inert");
    expect(db.rows.find((row) => row.version === 3).state).toBe("published");
    await expect(publishDraftWorkflow(db, draft.id, 4, 2, 300)).rejects.toThrow("expected v2");
    await publishDraftWorkflow(db, draft.id, 4, 3, 300);
    expect(db.rows.find((row) => row.version === 3).state).toBe("retired");
    expect(db.rows.find((row) => row.version === 4).state).toBe("published");
  });

  it("publishes a bundled first version only when the behavior-release path calls it", async () => {
    const db = fakeD1();
    expect(await publishedWorkflow(db, INITIAL_VIRTUAL_WORKFLOW.id)).toBeNull();

    await publishBundledWorkflow(db, INITIAL_VIRTUAL_WORKFLOW, 100);

    expect(await publishedWorkflow(db, INITIAL_VIRTUAL_WORKFLOW.id)).toEqual(INITIAL_VIRTUAL_WORKFLOW);
    expect(db.rows).toMatchObject([{ workflow_id: "initial-virtual", version: 3, state: "published", published_at: 100 }]);
  });
});
