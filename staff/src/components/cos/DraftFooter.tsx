import { useCallback, useState } from 'react';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import type { VoiceDraftMeta } from '../../types/cos';

export default function DraftFooter({ copy, meta }: { copy: string; meta: VoiceDraftMeta }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(copy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [copy]);

  return (
    <div className="mt-1.5 ml-1 space-y-1">
      <div className="flex items-center gap-2 text-xs text-amari-text-muted">
        <button onClick={onCopy} className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-amari-light-sand transition-colors">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="capitalize">{meta.channel !== 'unknown' ? meta.channel : 'copy'}</span>
        {meta.passedClean ? (
          <span className="text-emerald-600">on-brand ✓</span>
        ) : (
          <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="w-3.5 h-3.5" /> give this one a read</span>
        )}
      </div>
      {meta.fixes.length > 0 && (
        <details className="text-xs text-amari-text-muted">
          <summary className="cursor-pointer select-none">what I cleaned ({meta.fixes.length})</summary>
          <ul className="mt-1 ml-4 list-disc space-y-0.5">{meta.fixes.map((fix, i) => <li key={i}>{fix}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
