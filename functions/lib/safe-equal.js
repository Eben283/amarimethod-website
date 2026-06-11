// Constant-time string comparison — avoids leaking a secret via response timing.
// A plain `a !== b` short-circuits at the first differing character, so the time
// it takes to reject a guess reveals how many leading characters were correct.
// This compares every character regardless. The length check leaks only the
// secret's length, which is not sensitive.
//
// Lives in functions/lib/ so any Pages Function can import it (Functions must not
// import from one another's api/*.js — shared helpers belong here).
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
