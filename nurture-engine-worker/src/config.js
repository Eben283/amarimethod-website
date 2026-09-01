// Nurture engine — sequence configuration. One frozen config per GHL nurture flow
// (8 GHL workflows → these 3 objects: the five "remove from" workflows are the `exits`
// lines). Template keys remain inert in shadow mode. Source-copy readiness is exposed by the
// automation registry; no sequence may be promoted merely because its schedule is modeled.
//
// Canonical shape (from acquisition-nurture.md):
//   sequenceId  stable id; namespaces enrollments + the automation_events log + idempotency
//   entry       { on: <event spec>, guard?: { notTags: [...] }, onEnter?: { addTags: [...] } }
//               guard tags are read from owned CRM at enroll time; onEnter tags are written to
//               owned CRM in active mode AND fed back through the engine as tag events (so Flow 3 enrolling
//               exits Flows 1+2 without a round-trip)
//   mode        "shadow" | "active" — shadow computes + logs would_send, never sends; DEFAULT
//               shadow so a new sequence always runs beside GHL until deliberately switched on
//   steps       ordered; `after` is relative to the PREVIOUS step (mirroring GHL wait nodes),
//               "0d" for the first. Kinds:
//                 email       { template }
//                 branch      { field, test: "filled_not_other", yes, no } — 2-way on a contact
//                             field, evaluated against a FRESH contact read at send time
//                 branch_map  { field, map: {value → template}, default } — n-way, same timing
//   exits       first-class event specs; any match cancels all remaining steps for that
//               enrollment. These lines ARE the five deleted "remove from" workflows.

// Calendars (TECHNICAL-REFERENCE / twin specs)
const DISCOVERY = "USgPsktqRcuomdUgpShL"; // Your Free Discovery Call
const DISCOVERY_AMBASSADOR = "aVE54Qf4lrbYTB0zFqXy"; // Ambassador Prospect Discovery Call
const INITIAL_IN_PERSON = "G7OAnnJuFbMF6nQSlZVQ";
const INITIAL_VIRTUAL = "ySmht5hx4uZGEpgZrlCw";
const FOLLOWUP_IN_PERSON_PKG = "ZO1jlGfy01rsxVqicoSB";
const FOLLOWUP_VIRTUAL_PKG = "bJFkhVP35Ecwh4tLnSmy";
const FOLLOWUP_IN_PERSON = "SKDVOL8wtUN6Ne0ppbC9";
const FOLLOWUP_VIRTUAL = "oVn77FcecFY16iS2pHyP";
const ENTRAINMENT = "B5aGXLoS4kzAjZAMMXxk";
const ENTRAINMENT_20 = "wO5lnu7BOQOHEJ5YQU0f";
const SINGLE_SESSION_50 = "waHmG2mHNThPfMVuNJWG";

// Series/upgrade products (Flow 3 purchase exits)
const PRODUCT_4_SESSION = "69986faa724ecd2343ebaa6e";
const PRODUCT_8_SESSION = "69987357c839790426996114";
const PRODUCT_UPGRADE_4 = "6998739230cc6054f9bba62d";
const PRODUCT_UPGRADE_8 = "699873d6990b71ebc1fa26b4";
const PRODUCT_6_WEEK_PRACTICE = "6a683360017263178d05d1a3";
const PRODUCT_12_WEEK_PRACTICE = "6a66cde7ef7b07f122ad46fb";

// Funnel-advance tags (exit signals; Flow 3's onEnter writes the second)
const TAG_WORKFLOW_2 = "booked discovery call - workflow 2";
const TAG_WORKFLOW_3 = "workflow 3 (customer attended 1st session)"; // RESOLVE FIRST: MASTER's name; verify vs memory-doc variant before active

const deepFreeze = (obj) => {
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(obj);
};

// Flow 1 Quiz to Pain Consultation email flow. The live source structure, all branch values,
// waits, subjects, preheaders, and bodies were captured by 2026-07-12. Exact native rendering
// is allowlisted; owned delivery remains deliberately absent, so this stays shadow-only.
export const FLOW_1_QUIZ = deepFreeze({
  name: "Quiz to Pain Consultation email flow",
  definitionVersion: 2,
  sequenceId: "flow-1-quiz",
  mode: "shadow",
  entry: {
    on: { kind: "quiz.submitted" },
    // no guard, no onEnter tags — the GHL workflow adds nothing on entry
  },
  steps: [
    { after: "0d", kind: "email", template: "f1-email-1-quiz-results" },
    {
      // Native CRM field. The CRM mirror adapter maps the transition-era GHL attribute ID to
      // this stable key; sequence logic never branches on a provider identity.
      after: "+3d", kind: "branch", field: "primaryPainLocation", test: "filled_not_other",
      yes: "f1-email-2", no: "f1-email-2-chronic",
    },
    { after: "+4d", kind: "email", template: "f1-email-3-real-reason" },
    {
      // 5-way pain-location branch — filter values EXTRACTED LIVE 2026-07-12 (is-any-of):
      // note "Ankles/Feet" and "Wrists/Hands" are single composite quiz values, and the
      // fallback (None) branch sends its own 4c variant with a "chronic pain" subject.
      after: "+3d", kind: "branch_map", field: "primaryPainLocation",
      map: {
        "Lower back": "f1-email-4a-spinal-wave", Hips: "f1-email-4a-spinal-wave",
        Neck: "f1-email-4b-power-posture", Shoulders: "f1-email-4b-power-posture", "Upper back": "f1-email-4b-power-posture",
        Knees: "f1-email-4c-spring-step", "Ankles/Feet": "f1-email-4c-spring-step",
        "Wrists/Hands": "f1-email-4d-hand-balancer", Elbows: "f1-email-4d-hand-balancer",
      },
      default: "f1-email-4c-chronic",
    },
    // Emails 5 and 6 fire 2 DAYS apart (extracted live 2026-07-12 — the old +8d/+10d were
    // stale label-derived guesses), and each has a located vs chronic SUBJECT variant
    // matching the same filled_not_other split as Email 2.
    {
      after: "+2d", kind: "branch", field: "primaryPainLocation", test: "filled_not_other",
      yes: "f1-email-5-skeptical", no: "f1-email-5-chronic",
    },
    {
      after: "+2d", kind: "branch", field: "primaryPainLocation", test: "filled_not_other",
      yes: "f1-email-6-when-ready", no: "f1-email-6-chronic",
    },
  ],
  exits: [
    // "Remove from quiz submitted workflow" — a discovery booking on either calendar. GHL
    // auto-confirms, so the booking moment reads as "confirmed" (first live payload,
    // 2026-07-12) — both statuses mean "booking happened", and this also covers the deleted
    // workflow's manual-confirm trigger (a confirm only ever advances the funnel).
    { kind: "appointment", statuses: ["booked", "confirmed"], calendarIds: [DISCOVERY, DISCOVERY_AMBASSADOR] },
    // "Remove from Workflow 1 if tagged workflow 2 or 3" + "remove from workflow 1 &2 if tagged w/3"
    { kind: "tag.added", tags: [TAG_WORKFLOW_2, TAG_WORKFLOW_3] },
  ],
});

// Flow 2 Pain Consutation to first booking email flow (live GHL name keeps the typo).
// The 2026-08-07 source is a Draft $29 / 50-minute Assessment path. Exact native rendering is
// allowlisted, but delivery and lifecycle activation remain unresolved, so this stays shadow-only.
export const FLOW_2_POST_DISCOVERY = deepFreeze({
  name: "Pain Consutation to first booking email flow",
  definitionVersion: 2,
  sequenceId: "flow-2-post-discovery",
  mode: "shadow",
  entry: {
    on: { kind: "appointment", statuses: ["showed"], calendarIds: [DISCOVERY] },
    guard: { notTags: ["ambassador-prospect"] }, // the GHL YES-branch exclusion
    onEnter: { addTags: ["discovery call attended"] }, // 8-workflow hotspot — GHL readers depend on it through transition
  },
  steps: [
    { after: "0d", kind: "email", template: "f2-email-1-good-talking" },
    {
      after: "+4d", kind: "branch", field: "primaryPainLocation", test: "filled_not_other",
      yes: "f2-email-2-personalized", no: "f2-email-2-chronic",
    },
  ],
  exits: [
    // "Remove from Pain consultation to first booking" — booked an initial session
    // (booked|confirmed: GHL auto-confirms, see Flow 1 exit note)
    { kind: "appointment", statuses: ["booked", "confirmed"], calendarIds: [INITIAL_IN_PERSON, INITIAL_VIRTUAL] },
    { kind: "tag.added", tags: [TAG_WORKFLOW_3] },
  ],
});

// Flow 3 First session to follow up session email flow. The live source now ends after its
// Day-5 email. The former Day-10 series pitch and its now-empty wait were deleted 2026-08-07.
// Seven appointment exits and four legacy series/upgrade purchase exits are retained exactly
// from the published removal workflow. The two current Practice products are explicit native
// exits as well: both existing purchase emitters already normalize them to durable product IDs,
// and continuing nurture after a completed 6-/12-week enrollment would be incorrect in a
// GHL-free system. This added native behavior stays inert while the sequence is shadow-only.
export const FLOW_3_POST_INITIAL = deepFreeze({
  name: "First session to follow up session email flow",
  definitionVersion: 2,
  sequenceId: "flow-3-post-initial",
  mode: "shadow",
  entry: {
    on: { kind: "appointment", statuses: ["showed"], calendarIds: [INITIAL_IN_PERSON, INITIAL_VIRTUAL] },
    guard: { notTags: ["affiliate-partner"] },
    // This tag IS the exit signal for Flows 1+2 — the engine feeds it back through the exit
    // pass on enrollment (and writes the owned CRM tag only after an active-mode cutover).
    onEnter: { addTags: [TAG_WORKFLOW_3] },
  },
  steps: [
    { after: "0d", kind: "email", template: "f3-email-1-protocols-portal" },
    { after: "+5d", kind: "email", template: "f3-email-2-practice-going" },
  ],
  exits: [
    // "Remove from First session to followup" — 11 GHL triggers collapsed:
    {
      kind: "purchase",
      productIds: [
        PRODUCT_4_SESSION, PRODUCT_8_SESSION, PRODUCT_UPGRADE_4, PRODUCT_UPGRADE_8,
        PRODUCT_6_WEEK_PRACTICE, PRODUCT_12_WEEK_PRACTICE,
      ],
    },
    {
      kind: "appointment", statuses: ["booked", "confirmed"],
      calendarIds: [
        FOLLOWUP_IN_PERSON_PKG, FOLLOWUP_VIRTUAL_PKG, FOLLOWUP_IN_PERSON,
        FOLLOWUP_VIRTUAL, ENTRAINMENT,
      ],
    },
    { kind: "appointment", statuses: ["confirmed"], calendarIds: [ENTRAINMENT_20, SINGLE_SESSION_50] },
  ],
});

export const SEQUENCES = Object.freeze([FLOW_1_QUIZ, FLOW_2_POST_DISCOVERY, FLOW_3_POST_INITIAL]);
