// Provider-neutral lead intake for the Amari Pain Pattern Quiz.
// The public Pages function remains responsible for origin, Turnstile, rate-limit, and
// idempotency gates. This Worker boundary authenticates the server caller, validates the
// normalized contract again, and atomically records owned contact state plus source evidence.

const SOURCE = "owned:quiz";
const RETENTION_DAYS = 400;
const TEXT_LIMITS = Object.freeze({
  firstName: 100,
  lastName: 100,
  email: 254,
  phone: 20,
  patternSignature: 120,
  primaryPainLocation: 160,
  painDuration: 240,
  treatmentsTried: 1200,
  painTrigger: 1200,
  additionalPainAreas: 1200,
  painIntensity: 240,
  painTiming: 1200,
  painType: 1200,
  aggravatingActivities: 1600,
  dailyImpact: 1600,
  treatmentResults: 1200,
  healthConditions: 1600,
  resultsSummary: 12_000,
});
const SCORE_KEYS = Object.freeze([
  "softTissueTension", "jointBoneAlignment", "patternDuration",
  "dailyActivitiesImpact", "bodyAdaptations",
]);
const ATTRIBUTE_FIELDS = Object.freeze([
  ["painPatternSignature", "patternSignature"],
  ...[
    "recoveryPotentialScore", "primaryPainLocation", "painDuration", "treatmentsTried",
    "painTrigger", "additionalPainAreas", "painIntensity", "painTiming", "painType",
    "aggravatingActivities", "dailyImpact", "treatmentResults", "healthConditions",
    "resultsSummary", "audience", "referralSource",
  ].map((key) => [key, key]),
]);

export class OwnedQuizIntakeError extends Error {
  constructor(message, code = "invalid_quiz_intake", status = 400) {
    super(message);
    this.name = "OwnedQuizIntakeError";
    this.code = code;
    this.status = status;
  }
}

function cleanText(value, key, required = false) {
  if (value == null || value === "") {
    if (required) throw new OwnedQuizIntakeError(`${key} is required`);
    return "";
  }
  if (typeof value !== "string") throw new OwnedQuizIntakeError(`${key} must be text`);
  const cleaned = value.trim();
  if ((required && !cleaned) || cleaned.length > TEXT_LIMITS[key]) {
    throw new OwnedQuizIntakeError(`${key} is invalid`);
  }
  return cleaned;
}

function cleanPhone(value) {
  const input = cleanText(value, "phone");
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeOwnedQuizIntake(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OwnedQuizIntakeError("quiz intake body is required");
  }
  const allowed = new Set([
    "idempotencyKey", ...Object.keys(TEXT_LIMITS), "recoveryPotentialScore", "painSeverity",
    "scores", "insights", "referralSource", "audience",
  ]);
  const unsupported = Object.keys(input).filter((key) => !allowed.has(key));
  if (unsupported.length) throw new OwnedQuizIntakeError("quiz intake has unsupported fields", "unsupported_fields");

  const idempotencyKey = String(input.idempotencyKey || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(idempotencyKey)) throw new OwnedQuizIntakeError("idempotencyKey is invalid");
  const email = cleanText(input.email, "email", true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OwnedQuizIntakeError("email is invalid");

  const normalized = {
    idempotencyKey,
    firstName: cleanText(input.firstName, "firstName", true),
    lastName: cleanText(input.lastName, "lastName", true),
    email,
    phone: cleanText(input.phone, "phone"),
    patternSignature: cleanText(input.patternSignature, "patternSignature"),
    primaryPainLocation: cleanText(input.primaryPainLocation, "primaryPainLocation"),
    painDuration: cleanText(input.painDuration, "painDuration"),
    treatmentsTried: cleanText(input.treatmentsTried, "treatmentsTried"),
    painTrigger: cleanText(input.painTrigger, "painTrigger"),
    additionalPainAreas: cleanText(input.additionalPainAreas, "additionalPainAreas"),
    painIntensity: cleanText(input.painIntensity, "painIntensity"),
    painTiming: cleanText(input.painTiming, "painTiming"),
    painType: cleanText(input.painType, "painType"),
    aggravatingActivities: cleanText(input.aggravatingActivities, "aggravatingActivities"),
    dailyImpact: cleanText(input.dailyImpact, "dailyImpact"),
    treatmentResults: cleanText(input.treatmentResults, "treatmentResults"),
    healthConditions: cleanText(input.healthConditions, "healthConditions"),
    resultsSummary: cleanText(input.resultsSummary, "resultsSummary", true),
    referralSource: input.referralSource == null || input.referralSource === ""
      ? null : String(input.referralSource).trim(),
    audience: input.audience == null ? null : String(input.audience),
  };
  if (normalized.referralSource && !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(normalized.referralSource)) {
    throw new OwnedQuizIntakeError("referralSource is invalid");
  }
  if (normalized.audience !== null && !["bay-area", "remote"].includes(normalized.audience)) {
    throw new OwnedQuizIntakeError("audience is invalid");
  }
  const recovery = Number(input.recoveryPotentialScore);
  if (!Number.isFinite(recovery) || recovery < 0 || recovery > 100) {
    throw new OwnedQuizIntakeError("recoveryPotentialScore is invalid");
  }
  normalized.recoveryPotentialScore = recovery;
  if (!["mild", "moderate", "severe"].includes(input.painSeverity)) {
    throw new OwnedQuizIntakeError("painSeverity is invalid");
  }
  normalized.painSeverity = input.painSeverity;

  if (input.scores !== null) {
    if (!input.scores || typeof input.scores !== "object" || Array.isArray(input.scores)) {
      throw new OwnedQuizIntakeError("scores are invalid");
    }
    normalized.scores = {};
    for (const key of SCORE_KEYS) {
      const value = Number(input.scores[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new OwnedQuizIntakeError(`scores.${key} is invalid`);
      }
      normalized.scores[key] = value;
    }
  } else {
    normalized.scores = null;
  }

  if (!Array.isArray(input.insights) || input.insights.length > 4) {
    throw new OwnedQuizIntakeError("insights are invalid");
  }
  normalized.insights = input.insights.map((insight) => {
    if (!insight || typeof insight !== "object" || Array.isArray(insight)) {
      throw new OwnedQuizIntakeError("insight is invalid");
    }
    const title = String(insight.title || "").trim();
    const description = String(insight.description || "").trim();
    if (!title || title.length > 160 || !description || description.length > 1200) {
      throw new OwnedQuizIntakeError("insight is invalid");
    }
    return { title, description };
  });
  return Object.freeze(normalized);
}

function quizTags(input) {
  const tags = ["quiz submitted", `pain-severity-${input.painSeverity}`];
  if (input.primaryPainLocation && input.primaryPainLocation !== "Unknown") {
    const slug = input.primaryPainLocation.toLowerCase()
      .replace(/\s*\/\s*/g, "-").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (slug) tags.push(`pain-location-${slug}`);
  }
  if (input.audience) tags.push(`audience-${input.audience}`);
  if (input.referralSource) tags.push(`referred-by-${input.referralSource.toLowerCase()}`);
  return [...new Set(tags)];
}

export async function upsertOwnedQuizIntake(db, rawInput, now = new Date().toISOString()) {
  if (!db) throw new OwnedQuizIntakeError("owned CRM is unavailable", "owned_crm_unavailable", 503);
  const input = normalizeOwnedQuizIntake(rawInput);
  const normalizedJson = canonicalJson(input);
  const payloadSha256 = await sha256(normalizedJson);
  const previous = await db.prepare(
    "SELECT contact_id, payload_sha256 FROM quiz_intake_submissions WHERE idempotency_key = ?",
  ).bind(input.idempotencyKey).first();
  if (previous) {
    if (previous.payload_sha256 !== payloadSha256) {
      throw new OwnedQuizIntakeError("idempotency key was reused", "idempotency_conflict", 409);
    }
    return Object.freeze({ contactId: previous.contact_id, deduped: true, payloadSha256 });
  }

  const matches = await db.prepare(`
    SELECT id, archived_at FROM contacts
     WHERE email_normalized = ?
     ORDER BY created_at, id
     LIMIT 2
  `).bind(input.email).all();
  if ((matches?.results || []).length > 1) {
    throw new OwnedQuizIntakeError("email matches multiple owned contacts", "ambiguous_contact", 409);
  }
  if (matches?.results?.[0]?.archived_at) {
    throw new OwnedQuizIntakeError("email belongs to an archived owned contact", "archived_contact_review", 409);
  }
  const contactId = matches?.results?.[0]?.id || `contact_email_${(await sha256(input.email)).slice(0, 32)}`;
  const displayName = `${input.firstName} ${input.lastName}`.trim();
  const phone = cleanPhone(input.phone);
  const retentionUntil = new Date(Date.parse(now) + RETENTION_DAYS * 86400000).toISOString();
  const submissionId = `quiz_intake_${input.idempotencyKey.slice(0, 32)}`;
  const attributes = ATTRIBUTE_FIELDS
    .map(([key, inputKey]) => [key, input[inputKey]])
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => [key, typeof value === "string" ? value : String(value)]);
  if (input.scores) attributes.push(["scores", canonicalJson(input.scores)]);
  if (input.insights.length) attributes.push(["insights", canonicalJson(input.insights)]);

  const statements = [
    db.prepare(`
      INSERT OR IGNORE INTO contacts
        (id, first_name, last_name, display_name, email_normalized, phone_e164,
         referral_source_label, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(contactId, input.firstName, input.lastName, displayName, input.email, phone,
      input.referralSource, now, now),
    db.prepare(`
      UPDATE contacts SET
        first_name = COALESCE(NULLIF(first_name, ''), ?),
        last_name = COALESCE(NULLIF(last_name, ''), ?),
        display_name = CASE WHEN display_name = '' OR display_name = 'Unnamed client' THEN ? ELSE display_name END,
        phone_e164 = COALESCE(phone_e164, ?),
        referral_source_label = COALESCE(referral_source_label, ?),
        updated_at = ?
      WHERE id = ? AND archived_at IS NULL
    `).bind(input.firstName, input.lastName, displayName, phone, input.referralSource, now, contactId),
    db.prepare(`
      INSERT INTO quiz_intake_submissions
        (id, idempotency_key, contact_id, payload_sha256, normalized_json,
         submitted_at, retention_until, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(submissionId, input.idempotencyKey, contactId, payloadSha256, normalizedJson,
      now, retentionUntil, now),
    db.prepare("DELETE FROM contact_tags WHERE contact_id = ? AND source = ?").bind(contactId, SOURCE),
    db.prepare("DELETE FROM contact_attributes WHERE contact_id = ? AND source = ?").bind(contactId, SOURCE),
    db.prepare(`
      INSERT OR IGNORE INTO contact_roles (contact_id, role, source, created_at)
      VALUES (?, 'lead', ?, ?)
    `).bind(contactId, SOURCE, now),
    ...quizTags(input).map((tag) => db.prepare(`
      INSERT INTO contact_tags (contact_id, tag, source, created_at) VALUES (?, ?, ?, ?)
    `).bind(contactId, tag, SOURCE, now)),
    ...attributes.map(([key, value]) => db.prepare(`
      INSERT INTO contact_attributes (contact_id, source, attribute_key, attribute_value, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(contactId, SOURCE, key, value, now)),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await db.prepare(
      "SELECT contact_id, payload_sha256 FROM quiz_intake_submissions WHERE idempotency_key = ?",
    ).bind(input.idempotencyKey).first();
    if (raced?.payload_sha256 === payloadSha256) {
      return Object.freeze({ contactId: raced.contact_id, deduped: true, payloadSha256 });
    }
    throw error;
  }
  return Object.freeze({ contactId, deduped: false, payloadSha256 });
}

export async function ownedQuizIntakeReadiness(db, now = new Date().toISOString()) {
  if (!db) return Object.freeze({ state: "unavailable", total: 0, expired: 0, lastSubmittedAt: null });
  try {
    const row = await db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN retention_until <= ? THEN 1 ELSE 0 END) AS expired,
             MAX(submitted_at) AS last_submitted_at
        FROM quiz_intake_submissions
    `).bind(now).first();
    const total = Number(row?.total || 0);
    const expired = Number(row?.expired || 0);
    return Object.freeze({
      state: expired > 0 ? "attention" : total > 0 ? "ready" : "empty",
      total,
      expired,
      lastSubmittedAt: row?.last_submitted_at || null,
    });
  } catch {
    return Object.freeze({ state: "unavailable", total: 0, expired: 0, lastSubmittedAt: null });
  }
}
