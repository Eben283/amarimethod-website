// Pure helpers for the aggregate owed list (staff-owed-list.js).

// Best-effort client name from an Amari appointment title. Titles vary:
//   " Amari Method Follow-up Session — In Person- Danny Blumrich"
//   "Amari Method follow up session with Danny Blumrich"
//   "Amari Method Partner Initial Session- Shannon Morse"
//   " Amari Method - Entrainment session Justin Grinius"
//   "Danny Blumrich"
// Returns null if nothing usable is left after stripping boilerplate.
export function clientNameFromTitle(title) {
  if (!title || typeof title !== 'string') return null;
  const t = title.trim();

  // "... with John Doe"
  const withIdx = t.toLowerCase().lastIndexOf(' with ');
  if (withIdx !== -1) {
    const n = t.slice(withIdx + 6).trim();
    if (n) return n;
  }
  // trailing "- John Doe" / "— John Doe" (a real name, not more boilerplate)
  const dash = t.match(/[-—]\s*([A-Z][A-Za-z'’.\- ]+)$/);
  if (dash) {
    const n = dash[1].trim();
    if (n && !/session|amari|in person|virtual|package|partner|entrainment/i.test(n)) return n;
  }
  // Fallback: strip known boilerplate, keep the remainder.
  const stripped = t
    .replace(/amari method/ig, '')
    .replace(/follow[- ]?up session/ig, '')
    .replace(/initial session/ig, '')
    .replace(/partner/ig, '')
    .replace(/entrainment session/ig, '')
    .replace(/entrainment/ig, '')
    .replace(/in person|virtual|package/ig, '')
    .replace(/session/ig, '')
    .replace(/[—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || null;
}

// Sort owed rows for display: owed first (high-confidence, then biggest gap),
// then anything errored, then paid-legacy, then square. Pure — returns a copy.
const STATUS_RANK = { owed: 0, unavailable: 1, 'paid-legacy': 2, square: 3 };

export function sortOwedRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 4;
    const rb = STATUS_RANK[b.status] ?? 4;
    if (ra !== rb) return ra - rb;
    if (a.status === 'owed') {
      const ca = a.confidence === 'high' ? 0 : 1;
      const cb = b.confidence === 'high' ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const sa = a.shortBy || 0;
      const sb = b.shortBy || 0;
      if (sa !== sb) return sb - sa;
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}
