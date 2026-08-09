import { describe, expect, it } from "vitest";
import {
  AUTOMATION_INVENTORY_AS_OF,
  automationFamilies,
  automationFamily,
  automationInventorySummary,
  familyForDefinition,
} from "./automation-families.js";

describe("provider-neutral automation families", () => {
  it("condenses the complete current inventory into 24 operational families plus one evidence-only group", () => {
    const families = automationFamilies();
    const summary = automationInventorySummary();

    expect(AUTOMATION_INVENTORY_AS_OF).toBe("2026-08-07");
    expect(families.filter((family) => family.kind === "operational")).toHaveLength(24);
    expect(families.filter((family) => family.kind === "evidence_only")).toHaveLength(1);
    expect(summary).toEqual(expect.objectContaining({
      sourceRecords: 82,
      publishedSourceRecords: 64,
      draftSourceRecords: 18,
      operationalFamilies: 24,
      evidenceOnlyGroups: 1,
      ownedDefinitions: 7,
    }));

    const records = families.flatMap((family) => family.sourceRecords);
    expect(new Set(records.map((record) => record.name)).size).toBe(82);
    expect(records.filter((record) => record.status === "published")).toHaveLength(64);
    expect(records.filter((record) => record.status === "draft")).toHaveLength(18);
  });

  it("keeps lifecycle family identity separate from the four reusable implementation units", () => {
    const families = automationFamilies();
    expect(new Set(families.flatMap((family) => family.implementationUnits))).toEqual(new Set([
      "shared-substrate",
      "reminder-confirmation",
      "nurture-sequence",
      "purchase-cluster",
      "pipeline-helper",
      "standalone-owned-port",
      "study-resident",
      "evidence-only",
    ]));
    expect(automationFamily("initial-session-reminders")).toEqual(expect.objectContaining({
      lifecycle: "sessions",
      implementationUnits: ["reminder-confirmation", "pipeline-helper"],
    }));
  });

  it("joins exact owned definitions to the family without pretending template bodies or external history are owned", () => {
    const family = automationFamily("initial-session-reminders");
    expect(family.ownedDefinitions.map((definition) => definition.id)).toEqual([
      "reminder:initial-in-person",
      "reminder:initial-virtual",
    ]);
    expect(family.ownedDefinitions[0]).toEqual(expect.objectContaining({
      trigger: expect.objectContaining({
        calendarIds: ["G7OAnnJuFbMF6nQSlZVQ"],
        statuses: ["booked", "confirmed"],
      }),
      steps: expect.arrayContaining([
        expect.objectContaining({ stepIndex: 1, at: "enroll", type: "email", template: "confirmation" }),
      ]),
    }));
    expect(family.evidence.gaps.map((gap) => gap.code)).toEqual(expect.arrayContaining([
      "external_canvas_history_not_imported",
      "owned_template_bodies_not_loaded",
    ]));
  });

  it("maps an owned engine definition back to its operational family", () => {
    expect(familyForDefinition("reminder", "discovery-call")).toEqual(expect.objectContaining({ key: "discovery-call-lifecycle" }));
    expect(familyForDefinition("nurture", "flow-3-post-initial")).toEqual(expect.objectContaining({ key: "post-session-nurture" }));
    expect(familyForDefinition("purchase", "missing")).toBeNull();
  });

  it("registers the first partner cutover slice with its shadow-only source copy", () => {
    const family = automationFamily("partner-session-lifecycle");
    expect(family).toEqual(expect.objectContaining({
      counts: expect.objectContaining({ ownedDefinitions: 1 }),
      ownedDefinitions: [expect.objectContaining({
        id: "reminder:partner-initial-in-person",
        mode: "shadow",
        trigger: expect.objectContaining({
          calendarIds: ["lfsnaiGiLNL2z12pLKDP"],
          statuses: ["confirmed"],
        }),
        messagePreview: expect.objectContaining({ status: "source_verified_read_only" }),
      })],
    }));
    expect(family.evidence.gaps.map((gap) => gap.code)).toContain("owned_delivery_templates_not_loaded");
  });

  it("labels a source-only family honestly", () => {
    const family = automationFamily("study-program");
    expect(family.ownedDefinitions).toEqual([]);
    expect(family.sourceRecords).toHaveLength(5);
    expect(family.evidence.gaps.map((gap) => gap.code)).toContain("owned_definition_not_available");
  });

  it("returns detached family models", () => {
    const family = automationFamily("quiz-nurture");
    family.sourceRecords[0].name = "tampered";
    family.ownedDefinitions[0].steps[0].template = "tampered";
    expect(automationFamily("quiz-nurture").sourceRecords[0].name).toBe("Flow 1 Quiz to Pain Consultation email flow");
    expect(automationFamily("quiz-nurture").ownedDefinitions[0].steps[0].template).toBe("f1-email-1-quiz-results");
  });
});
