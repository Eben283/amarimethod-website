# Unified study enrollment and booking — implementation plan

Closes #440.

## User contract

Every active study page will provide one native Amari experience:

1. Read study details and complete eligibility questions.
2. Select a time from the existing native Study Session calendar on that same page.
3. Enter contact details once and submit.
4. Receive a thank-you state only after enrollment and the calendar appointment are both confirmed.

There is no booking modal, no GHL calendar embed, no second contact form, and no pre-booking SMS.

## Active study coverage

The shared registry remains the source of truth.

| Public page | Registry study | Required participant tag |
| --- | --- | --- |
| Elbow | tennis-elbow | elbow-study-participant |
| Hand | hand | hand-study-participant |
| Jaw | tmj | tmj-study-participant |
| Shoulder | desk-shoulders | shoulder-study-participant |
| Foot | runners-lower-leg | lowerleg-study-participant |

Each submission retains the page-specific optional body-side input and publication-consent value.

## Source changes

### 1. One server-owned command

Add `functions/api/study-enroll-book.js` and a narrow library module beneath `functions/lib/`.

The command accepts a registry slug, validated study input, and a selected native slot. It:

- resolves the study only from `STUDIES`;
- validates eligibility, name, email, phone, and slot;
- normalizes and writes the correct participant tag and Study Name in the contact upsert;
- checks the selected slot against the existing app buffer;
- creates exactly one appointment on the existing study calendar;
- returns an opaque operation identifier plus the booked start time.

It must not create a calendar, workflow, payment product, widget, or outbound message.

### 2. Durable idempotency and failure truth

Before any provider call, write an immutable operation record to the cloud-owned data store with:

- opaque operation ID and request idempotency key;
- registry slug and non-sensitive result state;
- contact and appointment provider IDs only after each succeeds;
- provider-call phase, retry-safe status, and failure classification.

A duplicate browser submission with the same key returns the first terminal result. A partial failure remains visible to the operator and returns an error state to the visitor; it does not show thank-you and does not blindly retry appointment creation.

### 3. Landing-page composition

Refactor the five `*-study.html` pages to render the existing native calendar behavior currently used by `book/study.html` directly in the landing page. Shared JS/CSS belongs in a reusable public module rather than copied across five HTML files.

The current standalone `book/study.html` remains available until the five-page migration passes acceptance tests, but it must not be the visitor handoff from a study page afterward.

### 4. Monitoring and reconciliation

Add a cloud-owned operator signal for:

- enrollment/upsert failure;
- appointment creation failure;
- partial operation;
- duplicate prevention collision;
- successful operation missing a required provider result.

Add a bounded reconciler for recent successful operations. It verifies the expected Study Name, participant tag, existing study calendar, and confirmed appointment. Missing evidence becomes an explicit incident/unknown state, not a silent success.

Do not infer workflow delivery from an HTTP success response. Confirmation workflow enrollment/execution remains a separately verified provider fact.

## Tests

Add focused automated tests for:

- all five public-page/registry/tag mappings;
- study name and optional-field preservation;
- invalid eligibility/contact/slot rejection;
- slot buffer enforcement;
- one idempotent retry produces one provider appointment;
- upsert failure creates no appointment;
- appointment failure never returns thank-you;
- partial-result incident creation;
- reconciler detects tag, Study Name, calendar, status, and missing-result drift;
- each landing page renders native calendar entry and has no redirect to `/book/study`, modal, or duplicate contact fields.

## Provider release gates — not part of this PR

This PR preserves all GHL workflows in their current state. It makes no GHL edit or publication.

After code review and Cloudflare deployment, a separate approved all-DND production proof must run one controlled booking per active study page. The release evidence must show correct Study Name/tag, one existing-calendar appointment, no pre-booking message, and no customer delivery. Only then may the existing post-booking confirmation/cancellation/no-show workflows be considered for separate publication/readback.
