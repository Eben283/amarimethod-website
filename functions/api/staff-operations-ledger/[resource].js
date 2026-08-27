// Nested service-ingest aliases:
//   POST /api/staff-operations-ledger/tasks
//   POST /api/staff-operations-ledger/events
//   POST /api/staff-operations-ledger/releases
//
// The sibling route also supports ?resource=... for callers that cannot use a
// nested path. Keeping the handler in one place prevents the service auth and
// fixed-actor rules from drifting between aliases.
import { onRequestOptions, onRequestPost } from "../staff-operations-ledger.js";

export { onRequestOptions, onRequestPost };
