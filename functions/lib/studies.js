// Single source of truth for the Amari study program.
//
// Each study is one prospective single-arm case series: 3 free 15-minute Amari
// rebalancing sessions, participant-reported outcomes, results published as a
// case series. The signup pages, signup function, staff capture panel, and
// results pages all read from this registry so adding a condition is one entry
// here plus a printed sign, not a code fork.
//
// See ops/docs/2026-07-07-study-rigor-spine.md for the design behind the
// instrument/measurement fields. Legal frame is non-negotiable: this is a case
// series of what PARTICIPANTS REPORTED with Amari rebalancing PROTOCOLS. No
// medical claims, no "Dr.", the practitioner teaches and guides.

// Instrument fields are the picks from the rigor spine. Live instruments have
// confirmed terms; draft ones stay "verify" until transcribed + cleared.
export const STUDIES = {
  "tennis-elbow": {
    slug: "tennis-elbow",
    tag: "elbow-study-participant",
    module: "elbow-reset",
    condition: "tennis elbow",
    shortName: "Elbow Pain Study",
    bodyQuestion: { key: "arm", label: "Which arm?", options: ["Left", "Right", "Both"] },
    instrument: { abbr: "PRTEE", name: "Patient-Rated Tennis Elbow Evaluation", recall: "past week", license: "free-attribution (MacDermid)" },
    venues: ["Tennis courts", "Pickleball courts"],
    status: "live", // already recruiting
  },
  "carpal-tunnel": {
    slug: "carpal-tunnel",
    tag: "carpal-study-participant",
    module: "hand-balancer",
    condition: "carpal tunnel / wrist pain",
    shortName: "Carpal Tunnel Study",
    bodyQuestion: { key: "hand", label: "Which hand?", options: ["Left", "Right", "Both"] },
    instrument: { abbr: "BCTQ", name: "Boston Carpal Tunnel Questionnaire", recall: "past 2 weeks", license: "verify" },
    venues: ["Coworking spaces", "Climbing gyms"],
    status: "draft",
  },
  "tmj": {
    slug: "tmj",
    tag: "tmj-study-participant",
    module: "jaw-align",
    condition: "TMJ / jaw pain",
    shortName: "Jaw Tension Study",
    bodyQuestion: { key: "side", label: "Which side?", options: ["Left", "Right", "Both"] },
    instrument: { abbr: "JFLS-8", name: "Jaw Functional Limitation Scale (8-item)", recall: "past month", license: "no-permission-required (Ohrbach)" },
    venues: ["Yoga studios", "Dentist / orthodontist referral"],
    status: "live",
  },
  "hand": {
    slug: "hand",
    tag: "hand-study-participant",
    module: "hand-balancer",
    condition: "hand / finger tendon pain (climbers)",
    shortName: "Hand Pain Study",
    bodyQuestion: { key: "hand", label: "Which hand?", options: ["Left", "Right", "Both"] },
    instrument: { abbr: "QuickDASH", name: "QuickDASH", recall: "past week", license: "free-clinical + Intent-to-Use (IWH)" },
    venues: ["Climbing gyms"],
    status: "live",
  },
  "runners-lower-leg": {
    slug: "runners-lower-leg",
    tag: "lowerleg-study-participant",
    module: "spring-step",
    condition: "plantar fasciitis / heel & foot pain",
    shortName: "Foot Pain Study",
    bodyQuestion: { key: "leg", label: "Which leg?", options: ["Left", "Right", "Both"] },
    instrument: { abbr: "FAAM", name: "Foot & Ankle Ability Measure (ADL)", recall: "past week", license: "free-clinical-research (Martin)" },
    venues: ["Running clubs", "Run-specialty stores", "Park trailheads"],
    status: "live",
  },
  "tech-neck": {
    slug: "tech-neck",
    tag: "neck-study-participant",
    module: "spinal-wave",
    condition: "neck & upper-back stiffness",
    shortName: "Tech Neck Study",
    bodyQuestion: null,
    instrument: { abbr: "NDI", name: "Neck Disability Index", recall: "today", license: "verify" },
    venues: ["Coworking spaces", "Tech offices"],
    status: "draft",
  },
  "desk-shoulders": {
    slug: "desk-shoulders",
    tag: "shoulder-study-participant",
    module: "power-posture",
    condition: "shoulder & upper-back pain",
    shortName: "Desk Shoulders Study",
    bodyQuestion: { key: "shoulder", label: "Which shoulder?", options: ["Left", "Right", "Both"] },
    instrument: { abbr: "SPADI", name: "Shoulder Pain & Disability Index", recall: "past week", license: "verify" },
    venues: ["Coworking spaces", "Tech offices"],
    status: "draft",
  },
  "lower-back": {
    slug: "lower-back",
    tag: "lowback-study-participant",
    module: "vertical-drop",
    condition: "lower-back pain from sitting",
    shortName: "Lower Back Study",
    bodyQuestion: null,
    instrument: { abbr: "ODI", name: "Oswestry Disability Index", recall: "today", license: "verify" },
    venues: ["Coworking spaces", "Long commuters", "Rideshare / delivery drivers"],
    status: "draft",
  },
  "sciatica": {
    slug: "sciatica",
    tag: "sciatica-study-participant",
    module: "suspension-squat",
    condition: "sciatica (leg pain)",
    shortName: "Sciatica Study",
    bodyQuestion: { key: "leg", label: "Which leg?", options: ["Left", "Right", "Both"] },
    instrument: { abbr: "SBI", name: "Sciatica Bothersomeness Index", recall: "past week", license: "verify" },
    venues: ["PT-clinic overflow", "CrossFit / running gyms"],
    status: "draft",
  },
};

// The one free 15-minute calendar all studies book into. Its NAME contains
// "15-minute" so journey-classification.js keeps these free sessions out of the
// paid ledger. Created 2026-07-07 as "Amari Study 15-Minute Session" (slug
// amari-study, Garrett sole provider, in-person 662 8th Ave).
export const STUDY_CALENDAR_ID = "J1N09B6bRYPOGNyVAfmX";

export function getStudyBySlug(slug) {
  return STUDIES[slug] || null;
}

export function getStudyByTag(tag) {
  return Object.values(STUDIES).find((s) => s.tag === tag) || null;
}

// The participant tags, for the staff panel to detect which study (if any) a
// contact is enrolled in.
export const STUDY_TAGS = Object.values(STUDIES).map((s) => s.tag);
