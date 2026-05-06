// Shared helpers for portal-related Pages Functions (portal-data, stream-token, etc.)
//
// Pages Functions can't reliably cross-import from other function files —
// shared utilities go here in functions/lib/ instead.

/**
 * Extract a custom field value from a GHL contact, given a fieldDefs map of
 * { [shortKey: string]: fieldId }. Falls back to matching by id/key/scoped key.
 */
export function getCustomField(contact, fieldKey, fieldDefs = {}) {
  if (!contact.customFields) return null;
  const fieldId = fieldDefs[fieldKey];
  const field = contact.customFields.find(
    (f) =>
      (fieldId && f.id === fieldId) ||
      f.id === fieldKey ||
      f.key === fieldKey ||
      f.key === `contact.${fieldKey}`
  );
  return field ? field.value ?? field.field_value : null;
}

/**
 * GHL checkbox fields return either: true (bool), "true" (string), or ["true"] (array).
 * Normalize all of them to a clean boolean.
 */
export function isChecked(raw) {
  if (!raw && raw !== 0) return false;
  if (Array.isArray(raw)) return raw.some(v => ["true","yes","1"].includes(String(v).toLowerCase()));
  return ["true","yes","1"].includes(String(raw).toLowerCase());
}

/**
 * Living Practice access compute. 8-session series always includes Living
 * Practice — don't require the field to be set explicitly.
 */
export function computeHasLivingPractice(lpRaw, tags, seriesType) {
  return isChecked(lpRaw) ||
    (tags || []).includes("living-practice-access") ||
    seriesType === "8-session";
}
