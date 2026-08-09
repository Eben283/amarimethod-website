import { describe, expect, it } from "vitest";
import {
  REGISTRY_VERSION,
  automationDefinitions,
  eventEvidence,
  findAutomationDefinition,
  registryEvidence,
} from "./automation-registry.js";

describe("owned automation registry", () => {
  it("publishes the six owned definitions with explicit versions and source evidence", () => {
    const definitions = automationDefinitions();
    expect(REGISTRY_VERSION).toBe(1);
    expect(definitions).toHaveLength(6);
    expect(definitions.map((definition) => definition.id)).toEqual([
      "reminder:initial-in-person",
      "reminder:initial-virtual",
      "reminder:discovery-call",
      "nurture:flow-1-quiz",
      "nurture:flow-2-post-discovery",
      "nurture:flow-3-post-initial",
    ]);
    for (const definition of definitions) {
      expect(definition.definitionVersion).toBe(1);
      expect(definition.name).toBeTruthy();
      expect(definition.mode).toBe("shadow");
      expect(definition.source.kind).toBe("owned_code");
      expect(definition.steps[0].stepIndex).toBe(0);
    }
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
      "delivery_outcome_not_recorded",
    ]);
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
