import { describe, expect, it } from "vitest";
import {
  REGISTRY_VERSION,
  automationDefinitions,
  eventEvidence,
  findAutomationDefinition,
  registryEvidence,
} from "./automation-registry.js";

describe("owned automation registry", () => {
  it("publishes the ten owned definitions with explicit versions and source evidence", () => {
    const definitions = automationDefinitions();
    expect(REGISTRY_VERSION).toBe(1);
    expect(definitions).toHaveLength(10);
    expect(definitions.map((definition) => definition.id)).toEqual([
      "reminder:initial-in-person",
      "reminder:initial-virtual",
      "reminder:discovery-call",
      "reminder:partner-initial-in-person",
      "reminder:assessment-no-show",
      "reminder:no-show-recovery",
      "nurture:flow-1-quiz",
      "nurture:flow-2-post-discovery",
      "nurture:flow-3-post-initial",
      "morning-sms:daily-staff-brief",
    ]);
    for (const definition of definitions) {
      expect(definition.definitionVersion).toBe(
        definition.id === "reminder:initial-in-person" ? 4
          : definition.id === "reminder:initial-virtual" ? 5
          : definition.id === "reminder:no-show-recovery" ? 2
          : definition.id === "nurture:flow-1-quiz" ? 2
          : definition.id === "nurture:flow-2-post-discovery" ? 2
          : definition.id === "nurture:flow-3-post-initial" ? 2
          : definition.id === "morning-sms:daily-staff-brief" ? 4 : 1,
      );
      expect(definition.name).toBeTruthy();
      expect(["shadow", "active"]).toContain(definition.mode);
      expect(definition.source.kind).toBe("owned_code");
      expect(definition.steps[0].stepIndex).toBe(0);
    }
  });

  it("registers the live Morning SMS from its owned Worker source", () => {
    expect(findAutomationDefinition("morning-sms", "daily-staff-brief")).toEqual(expect.objectContaining({
      id: "morning-sms:daily-staff-brief",
      name: "Morning SMS to Eben and Garrett",
      mode: "active",
      authority: "executable_definition",
      trigger: expect.objectContaining({
        cron: "*/5 11-19 * * MON-SAT",
        timeZone: "America/Los_Angeles",
      }),
      agendaCopy: {
        unavailable: "Good morning, time to prepare for the day. Today's appointment list could not be loaded.",
        empty: "Good morning — no appointments today.",
        header: "Today's appointments:",
        appointmentLine: "{{time}} — {{label}}",
        footer: "Time to prepare for the day.",
      },
      steps: expect.arrayContaining([
        expect.objectContaining({ id: "morning-last-session", handler: "identify_last_package_session", type: "reconcile", result: "SELL cues" }),
        expect.objectContaining({
          id: "morning-send-agenda",
          handler: "send_due_sms",
          messageKind: "prepare",
          type: "sms",
          audience: "Eben and Garrett",
          logic: expect.arrayContaining([
            "Append SELL: LAST PACKAGE SESSION only when the owned package ledger proves it with high confidence or a manual lock.",
            "Send the completed agenda separately to Eben and Garrett.",
          ]),
        }),
        expect.objectContaining({ id: "morning-send-meeting", handler: "send_due_sms", messageKind: "meeting", type: "sms", audience: "Eben and Garrett" }),
      ]),
      source: {
        kind: "owned_code",
        path: "morning-sms-worker/src/config.js",
      },
    }));
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
      definitionVersion: 4,
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
      definitionVersion: 5,
      trigger: {
        calendarIds: ["ySmht5hx4uZGEpgZrlCw"],
        statuses: ["confirmed"],
        modifiedBy: ["user", "customer"],
        modifiedByByCalendar: { ySmht5hx4uZGEpgZrlCw: null },
      },
      messagePreview: expect.objectContaining({ status: "source_verified_read_only" }),
      cutoverReadiness: expect.objectContaining({
        status: "proof_ready",
        requirements: expect.arrayContaining([
          expect.objectContaining({ code: "owned_delivery_built", status: "proven" }),
          expect.objectContaining({ code: "reschedule_confirmation_built", status: "proven" }),
          expect.objectContaining({ code: "native_shadow_proof_pending", status: "review" }),
        ]),
      }),
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

  it("shows the full GHL no-show source and the gated owned-delivery release", () => {
    const noShow = findAutomationDefinition("reminder", "no-show-recovery");
    expect(noShow).toEqual(expect.objectContaining({
      name: "No Show Email SMS series",
      mode: "shadow",
      trigger: expect.objectContaining({ statuses: ["noshow"], eventTypes: ["normal"] }),
      exits: [expect.objectContaining({ kind: "rebooking", statuses: ["confirmed"], scope: "contact" })],
      messagePreview: expect.objectContaining({ status: "delivery_built_release_gated", sourceDecisionChecks: expect.any(Array) }),
      cutoverReadiness: expect.objectContaining({
        status: "proof_ready",
        requirements: expect.arrayContaining([
          expect.objectContaining({ code: "source_copy_reconciled", status: "proven" }),
          expect.objectContaining({ code: "owned_rebooking_equivalence_proven", status: "proven" }),
          expect.objectContaining({ code: "delivery_adapter_built", status: "proven" }),
          expect.objectContaining({ code: "terminal_sms_receipts_built", status: "proven" }),
          expect.objectContaining({ code: "missed_count_owner_retained", status: "proven" }),
        ]),
      }),
      source: { kind: "owned_code", path: "reminder-engine-worker/src/no-show-recovery-workflow.js" },
    }));
    expect(noShow.trigger.calendarIds).toHaveLength(11);
    expect(noShow.trigger.contactModeByCalendar).toEqual({
      G7OAnnJuFbMF6nQSlZVQ: "contact",
      ySmht5hx4uZGEpgZrlCw: "contact",
      P7T6M1w8wtuRfwAqzOVw: "contact",
      wO5lnu7BOQOHEJ5YQU0f: "contact",
      waHmG2mHNThPfMVuNJWG: "contact",
    });
    expect(noShow.messagePreview.notices).toHaveLength(4);
  });

  it("publishes honest nurture cutover gates and the current two-email post-initial source", () => {
    const quiz = findAutomationDefinition("nurture", "flow-1-quiz");
    const assessment = findAutomationDefinition("nurture", "flow-2-post-discovery");
    const postInitial = findAutomationDefinition("nurture", "flow-3-post-initial");

    expect(quiz.cutoverReadiness).toEqual(expect.objectContaining({
      status: "not_eligible",
      requirements: expect.arrayContaining([
        expect.objectContaining({ code: "owned_quiz_intake_built", status: "proven" }),
        expect.objectContaining({ code: "owned_quiz_shadow_handoff_built", status: "proven" }),
        expect.objectContaining({ code: "owned_quiz_retention_plan_built", status: "proven" }),
        expect.objectContaining({ code: "retention_execution_policy_pending", status: "blocked" }),
        expect.objectContaining({ code: "public_quiz_bridge_pending", status: "blocked" }),
        expect.objectContaining({ code: "owned_contact_reads_built", status: "proven" }),
        expect.objectContaining({ code: "enrollment_transfer_built", status: "proven" }),
        expect.objectContaining({ code: "live_enrollment_snapshot_pending", status: "review" }),
        expect.objectContaining({ code: "owned_delivery_built", status: "proven" }),
        expect.objectContaining({ code: "delivery_exception_visibility_built", status: "proven" }),
        expect.objectContaining({ code: "terminal_delivery_receipts_missing", status: "blocked" }),
      ]),
    }));
    expect(assessment.cutoverReadiness).toEqual(expect.objectContaining({
      status: "not_eligible",
      requirements: expect.arrayContaining([
        expect.objectContaining({ code: "activation_owner_unresolved", status: "review" }),
      ]),
    }));
    expect(postInitial).toEqual(expect.objectContaining({
      definitionVersion: 2,
      mode: "shadow",
      messagePreview: expect.objectContaining({
        status: "source_verified_read_only",
        notices: expect.arrayContaining([
          expect.objectContaining({ stepIndex: 0, subject: "Your protocols are in the portal, {{contact.first_name}}" }),
          expect.objectContaining({ stepIndex: 1, subject: "How's the practice going, {{contact.first_name}}?" }),
        ]),
      }),
      cutoverReadiness: expect.objectContaining({
        status: "not_eligible",
        requirements: expect.arrayContaining([
          expect.objectContaining({ code: "source_structure_reconciled", status: "proven" }),
          expect.objectContaining({ code: "current_practice_purchase_exit_owned", status: "proven" }),
          expect.objectContaining({ code: "owned_template_renderer_built", status: "proven" }),
          expect.objectContaining({ code: "owned_delivery_built", status: "proven" }),
          expect.objectContaining({ code: "terminal_delivery_receipts_missing", status: "blocked" }),
        ]),
      }),
    }));
    expect(postInitial.cutoverReadiness.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "enrollment_transfer_built", status: "proven" }),
      expect.objectContaining({ code: "live_enrollment_snapshot_pending", status: "review" }),
    ]));
    expect(postInitial.steps).toHaveLength(2);
    expect(postInitial.messagePreview.notices).toHaveLength(2);
    expect(postInitial.exits.filter((exit) => exit.kind === "appointment").flatMap((exit) => exit.calendarIds)).toEqual(expect.arrayContaining([
      "wO5lnu7BOQOHEJ5YQU0f",
      "waHmG2mHNThPfMVuNJWG",
    ]));
    expect(postInitial.exits.find((exit) => exit.kind === "purchase").productIds).toEqual(expect.arrayContaining([
      "6a683360017263178d05d1a3",
      "6a66cde7ef7b07f122ad46fb",
    ]));
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
