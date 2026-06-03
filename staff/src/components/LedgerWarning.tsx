import { AlertTriangle, Lock } from 'lucide-react';

interface Props {
  confidence?: 'high' | 'low';
  ambiguities?: string[];
  manualLock?: boolean;
  displaySource?: string;
  derivedRemaining?: number;
  displayedRemaining?: number;
  purchased?: number | null;
  attended?: number;
  // Compact = small inline icon (BalancesPage row). Full = larger badge
  // suitable for a card header (ClientDetailPage Session Progress card).
  size?: 'compact' | 'full';
}

// Renders a warning icon when the ledger derivation has any uncertainty
// (low confidence, manual lock, or display-source fallback). Hover
// shows a human-readable explanation of what's ambiguous and what we're
// actually displaying vs what the math derived.
//
// Returns null when everything is clean (no icon). Caller can render
// unconditionally.
export default function LedgerWarning({
  confidence,
  ambiguities = [],
  manualLock = false,
  displaySource,
  derivedRemaining,
  displayedRemaining,
  purchased,
  attended,
  size = 'compact',
}: Props) {
  const isLowConfidence = confidence === 'low';
  const isLocked = manualLock === true;
  const hasFallback = displaySource === 'manual-lock' || displaySource === 'low-confidence-fallback';

  // Nothing to flag — clean derivation.
  if (!isLowConfidence && !isLocked && !hasFallback) return null;

  // Build human-readable explanation.
  const lines: string[] = [];
  if (isLocked) {
    lines.push('Manual lock is set — showing Garrett\'s managed value, not the derived count.');
    if (derivedRemaining !== undefined && displayedRemaining !== undefined && derivedRemaining !== displayedRemaining) {
      lines.push(`Displayed: ${displayedRemaining} remaining. Derived from orders + appointments: ${derivedRemaining}.`);
    }
  } else if (displaySource === 'low-confidence-fallback') {
    lines.push('Derivation has ambiguities — falling back to the GHL field value.');
    if (derivedRemaining !== undefined && displayedRemaining !== undefined && derivedRemaining !== displayedRemaining) {
      lines.push(`Field says ${displayedRemaining}; derived says ${derivedRemaining}.`);
    }
  } else if (isLowConfidence) {
    lines.push('Ledger derivation has low confidence.');
  }
  if (purchased != null && attended != null) {
    lines.push(`Package: ${attended}/${purchased} used.`);
  }
  for (const a of ambiguities.slice(0, 5)) {
    // Skip the boilerplate fallback message — already explained above.
    if (a.includes('session-ledger not available')) continue;
    lines.push(`• ${a}`);
  }
  const title = lines.join('\n');

  const Icon = isLocked ? Lock : AlertTriangle;
  const colorClass = isLocked ? 'text-amari-text-muted' : 'text-amber-500';

  if (size === 'full') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-xs ${colorClass} cursor-help`}
        title={title}
        aria-label={title}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{isLocked ? 'Manually managed' : 'Check derivation'}</span>
      </span>
    );
  }

  return (
    <Icon
      className={`w-3 h-3 ${colorClass} flex-shrink-0 cursor-help`}
      title={title}
      aria-label={title}
    />
  );
}
