import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Check } from 'lucide-react';
import { sendPayLink, type PayLinkProduct } from '../lib/api';

type PayRow = { product: PayLinkProduct; label: string; price: string; primary: boolean };

/** Default ladder — new clients. Practice 6/12-week SMS wait on hosted paylinks. */
const DEFAULT_PRODUCTS: PayRow[] = [
  { product: 'follow-up', label: 'Single session', price: '$285', primary: true },
  { product: 'amari-assessment', label: 'Assessment', price: '$29', primary: true },
  { product: 'initial-in-person', label: 'Initial — In Person', price: '$225', primary: false },
  { product: 'initial-virtual', label: 'Initial — Virtual', price: '$225', primary: false },
  { product: 'living-practice', label: 'Living Practice', price: '$347', primary: false },
];

/** Founder's Circle keep the legacy 4/8/upgrade ladder + $190 single. */
const FOUNDERS_PRODUCTS: PayRow[] = [
  { product: '8-session-series', label: '8-Pack', price: '$1,295', primary: true },
  { product: '4-session-series', label: '4-Pack', price: '$720', primary: true },
  { product: 'follow-up', label: 'Follow-up session', price: '$190', primary: true },
  { product: 'initial-in-person', label: 'Initial — In Person', price: '$225', primary: false },
  { product: 'initial-virtual', label: 'Initial — Virtual', price: '$225', primary: false },
  { product: 'upgrade-initial-to-4', label: 'Upgrade: Initial to 4', price: '$495', primary: false },
  { product: 'upgrade-initial-to-8', label: 'Upgrade: Initial to 8', price: '$1,070', primary: false },
  { product: 'upgrade-4-to-8', label: 'Upgrade: 4 to 8', price: '$575', primary: false },
  { product: 'living-practice', label: 'Living Practice', price: '$347', primary: false },
  { product: 'amari-assessment', label: 'Assessment', price: '$29', primary: false },
];

export default function PayLinkSheet({
  contactId,
  isFoundersCircle = false,
  onClose,
  onLinkSent,
}: {
  contactId: string;
  isFoundersCircle?: boolean;
  onClose: () => void;
  onLinkSent?: (note: string) => void;
}) {
  const [status, setStatus] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({});
  const [showMore, setShowMore] = useState(false);
  const products = isFoundersCircle ? FOUNDERS_PRODUCTS : DEFAULT_PRODUCTS;
  const visible = showMore ? products : products.filter((p) => p.primary);

  async function handleSend(product: PayLinkProduct, label: string) {
    if (status[product] === 'sending' || status[product] === 'sent') return;
    setStatus((s) => ({ ...s, [product]: 'sending' }));
    try {
      await sendPayLink(contactId, product);
      setStatus((s) => ({ ...s, [product]: 'sent' }));
      onLinkSent?.(`Sent ${label} pay link`);
    } catch {
      setStatus((s) => ({ ...s, [product]: 'error' }));
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative rounded-t-2xl bg-white px-4 pb-8 pt-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="font-semibold text-amari-charcoal">
            {isFoundersCircle ? "Send link · Founder's Circle" : 'Send link'}
          </span>
          <button type="button" onClick={onClose} className="text-amari-text-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!isFoundersCircle && (
          <p className="mb-3 text-xs text-amari-text-muted">
            Default ladder: $285 single · $3,000 6-week · $5,400 12-week. Practice SMS links land once GHL paylinks are pasted.
          </p>
        )}

        <div className="space-y-2">
          {visible.map(({ product, label, price }) => {
            const s = status[product] || 'idle';
            return (
              <div
                key={product}
                className="flex items-center justify-between rounded-xl border border-amari-border px-3 py-2.5"
              >
                <div>
                  <span className="text-sm font-medium text-amari-charcoal">{label}</span>
                  <span className="ml-2 text-sm text-amari-text-muted">{price}</span>
                </div>
                <button
                  type="button"
                  disabled={s === 'sending'}
                  onClick={() => handleSend(product, label)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    s === 'sent' ? 'bg-green-50 text-green-700' :
                    s === 'error' ? 'bg-red-50 text-red-600' :
                    'bg-amari-charcoal text-white'
                  }`}
                >
                  {s === 'sending' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                   s === 'sent' ? <Check className="h-3.5 w-3.5" /> :
                   'Send'}
                </button>
              </div>
            );
          })}
        </div>

        {products.some((p) => !p.primary) && (
          <button
            type="button"
            className="mt-3 w-full text-center text-sm text-amari-text-muted"
            onClick={() => setShowMore((v) => !v)}
          >
            {showMore ? 'Fewer products' : 'More products'}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
