import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Check } from 'lucide-react';
import { sendPayLink, type PayLinkProduct } from '../lib/api';

const PAY_PRODUCTS: { product: PayLinkProduct; label: string; price: string; primary: boolean }[] = [
  { product: '8-session-series', label: '8-Pack', price: '$1,295', primary: true },
  { product: '4-session-series', label: '4-Pack', price: '$720', primary: true },
  { product: 'initial-in-person', label: 'Initial — In Person', price: '$225', primary: false },
  { product: 'initial-virtual', label: 'Initial — Virtual', price: '$225', primary: false },
  { product: 'upgrade-initial-to-4', label: 'Upgrade: Initial to 4', price: '$495', primary: false },
  { product: 'upgrade-initial-to-8', label: 'Upgrade: Initial to 8', price: '$1,070', primary: false },
  { product: 'upgrade-4-to-8', label: 'Upgrade: 4 to 8', price: '$575', primary: false },
  { product: 'follow-up', label: 'Follow-up session', price: '$190', primary: false },
  { product: 'living-practice', label: 'Living Practice', price: '$347', primary: false },
];

export default function PayLinkSheet({
  contactId,
  onClose,
  onLinkSent,
}: {
  contactId: string;
  onClose: () => void;
  onLinkSent?: (note: string) => void;
}) {
  const [status, setStatus] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({});
  const [showMore, setShowMore] = useState(false);
  const visible = showMore ? PAY_PRODUCTS : PAY_PRODUCTS.filter((p) => p.primary);

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
          <span className="font-semibold text-amari-charcoal">Send link</span>
          <button type="button" onClick={onClose} className="text-amari-text-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

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
                   s === 'error' ? 'Error' : 'Send'}
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="mt-3 w-full text-center text-xs text-amari-text-muted"
        >
          {showMore ? 'Fewer options' : 'More options'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
