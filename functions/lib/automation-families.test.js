import { describe, expect, it } from "vitest";
import {
  AUTOMATION_INVENTORY_AS_OF,
  automationFamilies,
  automationFamily,
  automationInventorySummary,
  familyForDefinition,
} from "./automation-families.js";

describe("provider-neutral automation families", () => {
  it("condenses the complete current inventory into 25 operational families plus one evidence-only group", () => {
    const families = automationFamilies();
    const summary = automationInventorySummary();

    expect(AUTOMATION_INVENTORY_AS_OF).toBe("2026-08-07");
    expect(families.filter((family) => family.kind === "operational")).toHaveLength(25);
    expect(families.filter((family) => family.kind === "evidence_only")).toHaveLength(1);
    expect(summary).toEqual(expect.objectContaining({
      sourceRecords: 82,
      publishedSourceRecords: 64,
      draftSourceRecords: 18,
      operationalFamilies: 25,
      evidenceOnlyGroups: 1,
      ownedDefinitions: 10,
    }));

    const records = families.flatMap((family) => family.sourceRecords);
    expect(new Set(records.map((record) => record.name)).size).toBe(82);
    expect(records.filter((record) => record.status === "published")).toHaveLength(64);
    expect(records.filter((record) => record.status === "draft")).toHaveLength(18);
  });

  it("shows the live Morning SMS as a source-backed session automation", () => {
    const family = automationFamily("morning-staff-sms");

    expect(family).toEqual(expect.objectContaining({
      name: "Morning SMS",
      lifecycle: "sessions",
      operatingState: "active",
      sourceRecords: [],
      ownedDefinitions: [expect.objectContaining({
        id: "morning-sms:daily-staff-brief",
        mode: "active",
        authority: "executable_definition",
      })],
      mapAuthority: "executable_definition",
    }));
    expect(family.cutoverTree).toBeUndefined();
    expect(family.ownedDefinitions[0].steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "morning-last-session", handler: "identify_last_package_session" }),
      expect.objectContaining({ id: "morning-send-agenda", handler: "send_due_sms", messageKind: "prepare" }),
      expect.objectContaining({ id: "morning-send-meeting", handler: "send_due_sms", messageKind: "meeting" }),
    ]));
    expect(family.ownedDefinitions[0].steps.some((step) => step.type === "wait")).toBe(false);
    expect(familyForDefinition("morning-sms", "daily-staff-brief")).toEqual(expect.objectContaining({ key: "morning-staff-sms" }));
    expect(family.evidence.gaps.map((gap) => gap.code)).not.toContain("owned_definition_not_available");
  });

  it("distinguishes executable maps from provider diagrams", () => {
    expect(automationFamily("morning-staff-sms").mapAuthority).toBe("executable_definition");
    expect(automationFamily("initial-session-reminders").mapAuthority).toBe("executable_definition");
    expect(automationFamily("follow-up-session-reminders").mapAuthority).toBe("executable_definition");
    expect(automationFamily("commerce-ledger-event-ingest").mapAuthority).toBe("executable_definition");
    expect(automationFamily("study-program").mapAuthority).toBe("not_mapped");
  });

  it("owns the exact runtime lookup keys used by both the API and Staff map", () => {
    expect(automationFamily("initial-session-reminders").runtimeFlowKeys).toEqual([
      "initial-in-person",
      "initial-virtual",
    ]);
    expect(automationFamily("follow-up-session-reminders").runtimeFlowKeys).toEqual([
      "follow-up-session-reminders",
    ]);
    expect(automationFamily("commerce-ledger-event-ingest").runtimeFlowKeys).toEqual([
      "assessment-paid-booking",
    ]);
    expect(automationFamily("study-program").runtimeFlowKeys).toEqual([]);
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
      operatingState: "active",
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
        calendarIds: ["G7OAnnJuFbMF6nQSlZVQ", "EM6vB2mq7EAdGCbUb3j1"],
        statuses: ["confirmed"],
        modifiedBy: ["user", "customer"],
      }),
      steps: expect.arrayContaining([
        expect.objectContaining({ stepIndex: 1, at: "enroll", type: "email", template: "confirmation" }),
      ]),
      messagePreview: expect.objectContaining({ status: "source_verified_read_only" }),
      cutoverReadiness: expect.objectContaining({ status: "active" }),
    }));
    expect(family.evidence.gaps.map((gap) => gap.code)).toEqual(expect.arrayContaining([
      "external_canvas_history_not_imported",
      "owned_delivery_templates_not_loaded",
    ]));
  });

  it("keeps the first cutover tree source-backed and visibly preserves the Assessment no-show gap", () => {
    const tree = automationFamily("initial-session-reminders").cutoverTree;
    expect(tree).toEqual(expect.objectContaining({ status: "live_workflow", title: "Initial / Assessment — in-person appointment path" }));
    expect(tree.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "confirmed", state: "verified_ghl", evidence: "Appointment Events Webhook" }),
      expect.objectContaining({ id: "confirmed-owned", state: "owned_live" }),
      expect.objectContaining({ id: "cancelled-owned", state: "proven_owned" }),
      expect.objectContaining({ id: "cancelled-rollback", state: "legacy_ghl", evidence: "remove from workflow in person booking" }),
      expect.objectContaining({ id: "noshow", state: "gap", evidence: "No Show Email SMS series trigger inventory" }),
      expect.objectContaining({ id: "noshow-shadow", state: "owned_shadow", evidence: "assessment-no-show definition v1" }),
    ]));
  });

  it("maps an owned engine definition back to its operational family", () => {
    expect(familyForDefinition("reminder", "discovery-call")).toEqual(expect.objectContaining({ key: "discovery-call-lifecycle" }));
    expect(familyForDefinition("nurture", "flow-3-post-initial")).toEqual(expect.objectContaining({ key: "post-session-nurture" }));
    expect(familyForDefinition("reminder", "assessment-no-show")).toEqual(expect.objectContaining({ key: "no-show-recovery" }));
    expect(familyForDefinition("reminder", "no-show-recovery")).toEqual(expect.objectContaining({ key: "no-show-recovery" }));
    expect(familyForDefinition("purchase", "missing")).toBeNull();
  });

  it("registers the Partner Initial provider-neutral delivery contract as hard-shadow", () => {
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
        messagePreview: expect.objectContaining({ status: "owned_delivery_contract_hard_shadow" }),
        cutoverReadiness: expect.objectContaining({
          status: "not_eligible",
          requirements: expect.arrayContaining([
            expect.objectContaining({ code: "no_show_series_exit_owned", status: "proven" }),
            expect.objectContaining({ code: "no_show_series_exit_shadow_publish_pending", status: "blocked" }),
            expect.objectContaining({ code: "owned_delivery_contract_built", status: "proven" }),
            expect.objectContaining({ code: "owned_client_manage_links_built", status: "proven" }),
            expect.objectContaining({ code: "owned_sms_provider_pending", status: "blocked" }),
          ]),
        }),
      })],
    }));
    expect(family.evidence.gaps.map((gap) => gap.code)).toContain("owned_delivery_contract_hard_shadow");
    expect(family.evidence.gaps.map((gap) => gap.code)).not.toContain("owned_delivery_templates_not_loaded");
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
