// The portal uses this same verified Google Business Profile review form.
// Keep the short link here rather than exposing the long Maps place ID in the
// staff interface; both existing links resolve to the same review destination.
export const GOOGLE_REVIEW_URL = 'https://g.page/r/Cd5GNnATe8p_EBM/review';

export function buildGoogleReviewRequest(firstName?: string | null): string {
  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi,';
  return `${greeting} Thank you for today. If you’d be open to sharing your experience, a Google review would really help others find Amari: ${GOOGLE_REVIEW_URL}\n\nThank you,\nGarrett`;
}
