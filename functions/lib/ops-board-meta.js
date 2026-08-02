// Board presentation metadata for Amari Ops — roles + change surfaces.
// Keeps the registry spine intact; this layer decides how rows behave on /ops.

export const OPS_BOARD_ROLE = Object.freeze({
  HOT: "hot",       // pay→book→confirm early warning
  QUIET: "quiet",   // messaging — silent unless collision/wrong-send
  MAP: "map",       // blast-radius / connection; don't scream UNKNOWN
});

/** @type {Readonly<Record<string, {role:string, changeSurface:{touch:string, blastRadius:string[], talkHint:string}}>>} */
export const OPS_BOARD_META = Object.freeze({
  assessment_paid_book: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "Purchase webhook → read requested_session_* → create appointment (ops-assessment + ghl-purchase-webhook).",
      blastRadius: ["intro_paid_book", "portal_followup_paid_book"],
      talkHint: "Fix paid Assessment → book without touching package credit.",
    },
  },
  intro_paid_book: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "create-checkout intro + purchase-webhook native paid book (ops-path-emit).",
      blastRadius: ["assessment_paid_book", "portal_followup_paid_book"],
      talkHint: "Fix Intro paid → book; shared book helper with Assessment/follow-up.",
    },
  },
  portal_followup_paid_book: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "portal-pay-followup slot save + purchase-webhook follow-up product book.",
      blastRadius: ["intro_paid_book", "assessment_paid_book"],
      talkHint: "Fix portal $190 pay → book; shares purchase-webhook book hop.",
    },
  },
  discovery_free_book: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "book/create-checkout free booking branch.",
      blastRadius: ["intro_paid_book", "assessment_paid_book"],
      talkHint: "Fix discovery free book; same create-checkout file as paid checkouts.",
    },
  },
  portal_package_book: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "portal-book auth + ledger gate + GHL appointment create.",
      blastRadius: ["staff_book", "order_package_credit"],
      talkHint: "Fix portal prepaid book; ledger gate shares session balance with package credit.",
    },
  },
  staff_book: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "staff-book appointment create.",
      blastRadius: ["portal_package_book", "discovery_free_book"],
      talkHint: "Fix staff book; calendar map is staff-only.",
    },
  },
  order_package_credit: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "ghl-purchase-webhook field PUT + purchase-cluster seam.",
      blastRadius: ["invoice_package_credit", "pos_card_fulfill", "series_reconcile"],
      talkHint: "Fix order → package credit; do not retouch Assessment book branch.",
    },
  },
  invoice_package_credit: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "ghl-invoice-webhook PUT + tag delta.",
      blastRadius: ["order_package_credit", "series_reconcile"],
      talkHint: "Fix invoice → package credit; parallel to order webhook, separate entry.",
    },
  },
  pos_card_fulfill: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "stripe-pos-webhook + staff-pos-fulfill GHL write.",
      blastRadius: ["order_package_credit", "invoice_package_credit"],
      talkHint: "Fix POS charge → fulfill; credits same session fields as package webhooks.",
    },
  },
  appointment_webhook: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "appointment-webhook ingest → reminder/nurture dispatch.",
      blastRadius: ["reminder_engine", "nurture_engine", "partner_welcome_message"],
      talkHint: "Fix appointment → engines; GHL webhook must be live for green traffic.",
    },
  },
  partner_welcome_message: {
    autoFix: true,
    role: OPS_BOARD_ROLE.QUIET,
    changeSurface: {
      touch: "Partner welcome / please-book — exit or skip when appointment already exists (GHL or owned).",
      blastRadius: ["appointment_webhook", "reminder_engine"],
      talkHint: "Stop welcome from sending after book — stay inside this path (Sean case).",
    },
  },
  comms_coherence: {
    autoFix: true,
    role: OPS_BOARD_ROLE.QUIET,
    changeSurface: {
      touch: "comms-coherence-worker OpenRouter flags.",
      blastRadius: ["conversation_cache"],
      talkHint: "Fix coherence checker; does not send client messages itself.",
    },
  },
  reminder_engine: {
    autoFix: true,
    role: OPS_BOARD_ROLE.QUIET,
    changeSurface: {
      touch: "reminder-engine-worker sweep + enroll.",
      blastRadius: ["appointment_webhook", "nurture_engine"],
      talkHint: "Fix reminder sends; enrollment comes from appointment webhook.",
    },
  },
  nurture_engine: {
    autoFix: true,
    role: OPS_BOARD_ROLE.QUIET,
    changeSurface: {
      touch: "nurture-engine-worker sweep + enroll/exit.",
      blastRadius: ["appointment_webhook", "reminder_engine", "order_package_credit"],
      talkHint: "Fix nurture sequences; exits also fire from purchase events.",
    },
  },
  morning_sms: {
    autoFix: true,
    role: OPS_BOARD_ROLE.QUIET,
    changeSurface: {
      touch: "morning-sms-worker cron → GHL conversations SMS.",
      blastRadius: ["ghl_token"],
      talkHint: "Fix morning Prepare/Meeting texts; GHL SMS path only.",
    },
  },
  chief_of_staff: {
    autoFix: true,
    role: OPS_BOARD_ROLE.MAP,
    changeSurface: {
      touch: "cos-auth + cos-chat (OpenRouter) + dist/cos SPA.",
      blastRadius: ["ghl_token"],
      talkHint: "Fix CoS login/chat; OpenRouter key + JWT — not staff PIN.",
    },
  },
  staff_auth: {
    role: OPS_BOARD_ROLE.MAP,
    changeSurface: {
      touch: "staff-auth PIN → JWT for /staff.",
      blastRadius: ["pos_card_fulfill", "staff_book"],
      talkHint: "Fix staff login; shared PIN secrets, not CoS.",
    },
  },
  portal_auth: {
    role: OPS_BOARD_ROLE.MAP,
    changeSurface: {
      touch: "portal-auth magic link + portal-verify session mint.",
      blastRadius: ["portal_package_book", "portal_followup_paid_book"],
      talkHint: "Fix client portal login email/verify; GHL tag + Resend/GHL mail.",
    },
  },
  ops_monitor: {
    role: OPS_BOARD_ROLE.MAP,
    changeSurface: {
      touch: "claude-config/scripts/amari-cloud-health.sh + its launchd schedule + /api/ops/monitor-event.",
      blastRadius: ["chief_of_staff", "ghl_token", "series_reconcile", "crm_mirror"],
      talkHint: "Restore the independent operations monitor; do not change customer-facing systems.",
    },
  },
  public_slots: {
    autoFix: true,
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "book/public-slots → GHL free-slots + look-busy + slot policy.",
      blastRadius: ["assessment_paid_book", "intro_paid_book", "discovery_free_book", "ghl_token"],
      talkHint: "Fix public availability; clients can't book if this is red.",
    },
  },
  stripe: {
    role: OPS_BOARD_ROLE.HOT,
    changeSurface: {
      touch: "STRIPE_SECRET_KEY + stripe-pos-webhook + staff-stripe-cards.",
      blastRadius: ["pos_card_fulfill", "order_package_credit"],
      talkHint: "Fix Stripe key/webhook; POS charge path depends on this.",
    },
  },
});

/** Default map role for infra deps not listed above. */
export function boardMetaFor(pathId) {
  return (
    OPS_BOARD_META[pathId] || {
      autoFix: false,
      role: OPS_BOARD_ROLE.MAP,
      changeSurface: {
        touch: "Infra dependency — connection / blast-radius only.",
        blastRadius: [],
        talkHint: "Touch only if this signal is the failure; keep money paths alone.",
      },
    }
  );
}

/** Display labels for board states (stop UNKNOWN scream). */
export const OPS_ROW_STATE = Object.freeze({
  HEALTHY: "healthy",
  SICK: "sick",
  STUCK: "stuck",
  IDLE: "idle",
  BLIND: "blind",
  MAP_OK: "map_ok",
  MAP_BAD: "map_bad",
});

export function isAttentionState(state) {
  return state === OPS_ROW_STATE.SICK || state === OPS_ROW_STATE.STUCK || state === OPS_ROW_STATE.MAP_BAD;
}
