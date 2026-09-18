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
4. The manual message export omits email unless email is requested separately, is capped at eight 50-record pages, and restarts from the beginning on the next invocation because its cursor expires.
5. Call recording, voicemail media, and transcription endpoints are not mirrored.
6. There is no account-level source-versus-owned reconciliation, export/restore proof, or approved ordinary-traffic observation window.

## Foundation in this branch

Migration `0035_ghl_communication_source_archive.sql` adds a revision-preserving raw GHL source archive. Signed webhooks, recent and historical conversation reads, and manual message export write the exact provider JSON before Staff normalization or contact matching. The conversation reader requests all twelve types currently documented by GHL. Unsupported and unmatched records remain archived even when Staff cannot render them.

This foundation is additive and does not activate sending or write to GHL. It must be installed through its protected schema workflow before the Worker is deployed.

## Remaining release gates

- Deploy the additive archive migration, then deploy the archive-aware Worker in that order.
- Build complete, resumable non-email and email history backfills.
- Mirror call media/transcripts and all required provider metadata.
- Extend Staff rendering for every relied-on channel and activity type.
- Reconcile counts, IDs, revisions, attachments, ordering, and sampled contacts against GHL with zero unexplained gaps.
- Prove degraded-state visibility, owned export, and restoration.
- Complete an approved ordinary-traffic observation window.
- Obtain separate explicit approval before cancelling GHL.
