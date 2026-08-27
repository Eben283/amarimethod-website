// Canonical Staff Operations Ledger route. The implementation remains in the
// shared Staff boundary so authentication and safe projection cannot drift.
export {
  onRequestOptions,
  onRequestGet,
  onRequestPost,
} from "../staff-operations-ledger.js";
