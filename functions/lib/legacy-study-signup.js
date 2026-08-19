// Cached pre-cutover study pages can still call their old signup endpoints.
// Keep those URLs non-mutating during the canonical-booking cutover: a stale
// page must never add a participant trigger tag before an appointment exists.
const LIVE_STUDY_SLUGS = new Set([
  "tennis-elbow",
  "tmj",
  "hand",
  "runners-lower-leg",
  "desk-shoulders",
]);

export function legacyStudySignupDisabledResponse(headers, studySlug) {
  if (!LIVE_STUDY_SLUGS.has(studySlug)) {
    throw new TypeError("live study slug required");
  }
  const bookingUrl = "/book/study?study=" + studySlug;
  return new Response(JSON.stringify({
    error: "Study signup now includes choosing your first session. Refresh this page or continue at " + bookingUrl + ".",
    bookingUrl,
    refreshRequired: true,
  }), {
    status: 409,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
