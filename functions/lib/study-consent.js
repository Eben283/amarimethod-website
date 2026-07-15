// Publish opt-in for study signups (first name + results in case series).
// Participation consent = submitting the join form; this tag is optional only.
// Copy: copy-drafts/study-consent.copy.txt

export const STUDY_PUBLISH_OPT_IN_TAG = "study-publish-opt-in";

export function wantsPublishOptIn(publishOptIn) {
  return publishOptIn === true;
}
