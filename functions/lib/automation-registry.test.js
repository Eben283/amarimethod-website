import { describe, expect, it } from "vitest";
import {
  REGISTRY_VERSION,
  automationDefinitions,
  eventEvidence,
  findAutomationDefinition,
  registryEvidence,
} from "./automation-registry.js";

describe("owned automation registry", () => {
  it("publishes the eight owned definitions with explicit versions and source evidence", () => {
    const definitions = automationDefinitions();
    expect(REGISTRY_VERSION).toBe(1);
    expect(definitions).toHaveLength(8);
    expect(definitions.map((definition) => definition.id)).toEqual([
      "reminder:initial-in-person",
      "reminder:initial-virtual",
      "reminder:discovery-call",
      "reminder:partner-initial-in-person",
      "reminder:assessment-no-show",
      "nurture:flow-1-quiz",
      "nurture:flow-2-post-discovery",
      "nurture:flow-3-post-initial",
    ]);
    for (const definition of definitions) {
      expect(definition.definitionVersion).toBe(
        definition.id === "reminder:initial-in-person" ? 3 : definition.id === "reminder:initial-virtual" ? 2 : 1,
      );
      expect(definition.name).toBeTruthy();
      expect(definition.mode).toBe("shadow");
      expect(definition.source.kind).toBe("owned_code");
      expect(definition.steps[0].stepIndex).toBe(0);
    }
  });

  it("exposes source-verified partner message copy as a read-only shadow preview", () => {
    const definition = findAutomationDefinition("reminder", "partner-initial-in-person");

    expect(definition).toEqual(expect.objectContaining({
      name: "In-Person Partner Session: Confirmation & Reminder Flow",
      mode: "shadow",
      messagePreview: expect.objectContaining({
        status: "source_verified_read_only",
        notices: expect.arrayContaining([
          expect.objectContaining({
            stepIndex: 1,
            channel: "email",
            audience: "client",
            subject: "Your partner session is confirmed",
          }),
          expect.objectContaining({
            stepIndex: 3,
            channel: "email",
            audience: "client",
            subject: "Your session is in 1 hour",
          }),
        ]),
      }),
      cutoverReadiness: expect.objectContaining({
        status: "not_eligible",
        requirements: expect.arrayContaining([
          expect.objectContaining({ code: "native_lifecycle_shadow_proven", status: "proven" }),
          expect.objectContaining({ code: "no_show_series_exit_not_owned", status: "blocked" }),
          expect.objectContaining({ code: "delivery_templates_and_adapter_not_owned", status: "blocked" }),
        ]),
      }),
    }));
    expect(definition.messagePreview.notices).toHaveLength(6);
  });

  it("records the live in-person cutover while keeping virtual delivery inactive", () => {
    const inPerson = findAutomationDefinition("reminder", "initial-in-person");
    const virtual = findAutomationDefinition("reminder", "initial-virtual");

    expect(inPerson).toEqual(expect.objectContaining({
      definitionVersion: 3,
      trigger: expect.objectContaining({ calendarIds: ["G7OAnnJuFbMF6nQSlZVQ", "EM6vB2mq7EAdGCbUb3j1"], statuses: ["confirmed"], modifiedBy: ["user", "customer"] }),
      messagePreview: expect.objectContaining({ status: "source_verified_read_only", notices: expect.any(Array) }),
      cutoverReadiness: expect.objectContaining({
        status: "active",
        requirements: expect.arrayContaining([
          expect.objectContaining({ code: "assessment_no_show_separate_gap", status: "review" }),
        ]),
      }),
    }));
    expect(inPerson.steps).toHaveLength(6);
    expect(inPerson.steps.some((step) => step.template === "equipment-list")).toBe(false);
    expect(virtual).toEqual(expect.objectContaining({
      definitionVersion: 2,
      trigger: { calendarIds: ["ySmht5hx4uZGEpgZrlCw"], statuses: ["confirmed"], modifiedBy: ["user", "customer"] },
      messagePreview: expect.objectContaining({ status: "source_verified_read_only" }),
      cutoverReadiness: expect.objectContaining({ status: "not_eligible" }),
    }));
  });

  it("models Assessment no-show recovery as a distinct shadow definition with a rebooking exit", () => {
    const noShow = findAutomationDefinition("reminder", "assessment-no-show");
    expect(noShow).toEqual(expect.objectContaining({
      name: "No Show Email SMS series — Assessment",
      mode: "shadow",
      trigger: { calendarIds: ["EM6vB2mq7EAdGCbUb3j1"], statuses: ["noshow"], modifiedBy: null },
      exits: [expect.objectContaining({ kind: "rebooking", statuses: ["confirmed"], scope: "contact" })],
      messagePreview: expect.objectContaining({ status: "source_verified_read_only" }),
      cutoverReadiness: expect.objectContaining({ status: "not_eligible" }),
    }));
    expect(noShow.steps.map((step) => step.at)).toEqual(["enroll", "enroll+1440m", "enroll+2880m"]);
  });

  it("returns detached read models so API consumers cannot mutate engine config", () => {
    const first = findAutomationDefinition("reminder", "initial-in-person");
    first.steps[0].template = "tampered";
    expect(findAutomationDefinition("reminder", "initial-in-person").steps[0].template).toBe("booked-internal");
    expect(findAutomationDefinition("purchase", "unknown")).toBeNull();
  });

  it("labels definition, legacy-history, delivery, and missing-store evidence gaps honestly", () => {
    const withoutDb = registryEvidence({ executionStoreConfigured: false });
    expect(withoutDb.executionSource).toBe("unavailable");
    expect(withoutDb.gaps.map((gap) => gap.code)).toEqual([
      "owned_definitions_only",
      "pre_registry_history_not_imported",
      "delivery_receipt_coverage_partial",
      "execution_store_unavailable",
    ]);

    const withDb = registryEvidence({ executionStoreConfigured: true });
    expect(withDb.executionSource).toBe("owned_d1_append_only_log");
    expect(withDb.gaps.map((gap) => gap.code)).not.toContain("execution_store_unavailable");
  });

  it("does not claim delivery when transport evidence is absent", () => {
    expect(eventEvidence({ action: "send", outcome: "sent", channel: "email", message_ref: null }).gaps.map((gap) => gap.code)).toEqual([
      "message_reference_missing",
      "email_final_delivery_unavailable",
    ]);
    expect(eventEvidence({ action: "send", outcome: "sent", channel: "sms", message_ref: "sms_1" }).gaps.map((gap) => gap.code)).toEqual([
      "delivery_outcome_pending",
    ]);
    expect(eventEvidence({ action: "send", outcome: "sent", channel: "sms", message_ref: "sms_1" }, { terminalOutcome: "delivered" }).gaps).toEqual([]);
    expect(eventEvidence({ action: "send", outcome: "delivered", channel: "email", message_ref: "msg_1" }).gaps).toEqual([]);
  });

  it("labels execution rows whose historical definition snapshot is not loaded", () => {
    expect(eventEvidence({
      engine: "reminder",
      flow_key: "initial-in-person",
      definition_version: 0,
      action: "enrolled",
    }).gaps).toEqual([expect.objectContaining({ code: "historical_definition_snapshot_not_loaded" })]);
  });
});
