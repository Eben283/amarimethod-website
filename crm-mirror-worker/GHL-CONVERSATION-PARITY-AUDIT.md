# GHL conversation parity audit

Status: **exit gate open**. Staff Communication is current for its existing projection, but it is not yet a complete replacement for GHL conversations.

## Production evidence — 2026-09-18

- Owned D1 contained 3,844 communication events across 583 threads.
- Projected event kinds were only call, SMS, and email.
- Thirty events had mirrored attachment locators.
- The oldest mirrored event was 2025-02-23; the newest was 2026-09-18.
- The five-minute recent-conversation lane was succeeding, but freshness does not prove historical completeness.

## Confirmed gaps

1. The conversation reader requested only call, SMS, and email. GHL also exposes Facebook, Google Business Messages, Instagram, WhatsApp, and five activity record types through this endpoint.
2. The Staff projection drops provider fields including original type identifiers, participants, content type, source/user/provider IDs, error metadata, call duration metadata, and email routing metadata.
3. Per-conversation reads retain only the newest 20 messages and do not paginate older history.
4. The projection path does not yet materialize the newly complete raw history into Staff; raw-history capture and Staff projection remain separate bounded phases.
5. Call recording, voicemail media, and transcription endpoints are not mirrored.
6. There is no account-level source-versus-owned reconciliation, export/restore proof, or approved ordinary-traffic observation window.

## Live foundation

Migration `0035_ghl_communication_source_archive.sql` provides a revision-preserving raw GHL source archive. Signed webhooks plus recent and historical conversation reads write the exact provider JSON before Staff normalization or contact matching. The conversation reader requests all twelve types currently documented by GHL. Unsupported and unmatched records remain archived even when Staff cannot render them.

PRs #649/#651/#652 installed and verified the schema and released the archive-aware Worker on 2026-09-18. This foundation is additive and does not activate sending or write to GHL.

## Resumable history backfill

The account-level export now uses independent non-email and email streams because GHL excludes email from the default response. Each stream consumes the provider's short-lived cursor only inside one invocation, while durable progress is stored as a bounded 30-day date window. Completed windows move backward to a fixed floor; capped windows resume immediately below the oldest archived row with a one-millisecond overlap. Raw archive writes are idempotent, so boundary overlap cannot duplicate source revisions. One bounded scheduled lane advances both streams. A separate scheduled pass projects supported archived events missing from Staff, only for already-linked contacts; historical rows neither manufacture unread work nor move the latest-message summary backward.

## Remaining release gates

- Continue observing the resumable non-email and email history backfills through completion.
- Add explicit Staff visibility for archived GHL activity types that are not email, SMS, or calls.
- Mirror call media/transcripts and all required provider metadata.
- Extend Staff rendering for every relied-on channel and activity type.
- Reconcile counts, IDs, revisions, attachments, ordering, and sampled contacts against GHL with zero unexplained gaps.
- Prove degraded-state visibility, owned export, and restoration.
- Complete an approved ordinary-traffic observation window.
- Obtain separate explicit approval before cancelling GHL.
