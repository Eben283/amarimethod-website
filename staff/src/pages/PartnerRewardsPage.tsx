import { FormEvent, useCallback, useEffect, useState } from 'react';

type Event = { id: string; reward_id: string; ts: number; actor: string; type: string; detail: Record<string, unknown> };
const inputClass = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';
const labelClass = 'block text-sm font-medium text-slate-700';

function eventDetail(event: Event) {
  if (typeof event.detail.amountCents === 'number') {
    const session = event.detail.sessionEntitlement ? ` + ${String(event.detail.sessionEntitlement)}` : '';
    return `$${(event.detail.amountCents / 100).toLocaleString()}${session} · hold to ${new Date(String(event.detail.holdUntil)).toLocaleDateString()}`;
  }
  if (event.detail.payoutReference) return `Payout reference: ${String(event.detail.payoutReference)}`;
  if (event.detail.reason) return String(event.detail.reason);
  if (event.detail.partnerContactId) return `Partner ${String(event.detail.partnerContactId)} → referred ${String(event.detail.referredContactId)}`;
  return 'Recorded manual evidence';
}

export default function PartnerRewardsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/staff-partner-rewards', { credentials: 'same-origin' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not load the partner-reward ledger');
      setEvents(body.rewards || []);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the partner-reward ledger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/staff-partner-rewards', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...Object.fromEntries(fields.entries()) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not record partner-reward evidence');
      event.currentTarget.reset();
      setNotice(`Recorded: ${body.state}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record partner-reward evidence');
    } finally {
      setSaving(false);
    }
  }

  return <main className="max-w-6xl mx-auto p-6 space-y-6">
    <header>
      <p className="text-sm uppercase tracking-wide text-amari-accent-warm">Manual ledger</p>
      <h1 className="text-3xl font-serif text-amari-charcoal">Partner rewards</h1>
      <p className="mt-2 max-w-3xl text-slate-600">$250 cash plus one Amari session for a qualifying 12-session Practice, or $500 cash plus one Amari session for 24 sessions. The referral must purchase within 90 days; payout is recorded only after the 30-day chargeback hold. This page sends no emails and initiates no payout.</p>
    </header>

    <section className="grid gap-4 lg:grid-cols-2" aria-label="Partner reward manual controls">
      <form onSubmit={(event) => submit(event, 'attribute')} className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold text-amari-charcoal">1. Record referral attribution</h2>
        <label className={labelClass}>Ledger reward ID<input required name="rewardId" pattern="[A-Za-z0-9_-]+" className={inputClass} placeholder="partner_20260811_001" /></label>
        <label className={labelClass}>Partner contact ID<input required name="partnerContactId" pattern="[A-Za-z0-9_-]+" className={inputClass} /></label>
        <label className={labelClass}>Referred contact ID<input required name="referredContactId" pattern="[A-Za-z0-9_-]+" className={inputClass} /></label>
        <label className={labelClass}>Referral date and time<input required name="referralAt" type="datetime-local" className={inputClass} /></label>
        <button disabled={saving} className="rounded-md bg-amari-charcoal px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Record attribution</button>
      </form>

      <form onSubmit={(event) => submit(event, 'qualify')} className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold text-amari-charcoal">2. Verify qualifying Practice purchase</h2>
        <label className={labelClass}>Ledger reward ID<input required name="rewardId" pattern="[A-Za-z0-9_-]+" className={inputClass} /></label>
        <label className={labelClass}>Stripe purchase date and time<input required name="purchasedAt" type="datetime-local" className={inputClass} /></label>
        <label className={labelClass}>Practice package<select required name="sessionCount" defaultValue="12" className={inputClass}><option value="12">12-session Practice — $250 + one Amari session</option><option value="24">24-session Practice — $500 + one Amari session</option></select></label>
        <button disabled={saving} className="rounded-md bg-amari-charcoal px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Start 30-day hold</button>
      </form>

      <form onSubmit={(event) => submit(event, 'pay')} className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold text-amari-charcoal">3. Record manual payout</h2>
        <p className="text-sm text-slate-600">This records the payout after the hold. It does not send money.</p>
        <label className={labelClass}>Ledger reward ID<input required name="rewardId" pattern="[A-Za-z0-9_-]+" className={inputClass} /></label>
        <label className={labelClass}>Payout reference<input required name="payoutReference" className={inputClass} placeholder="bank transfer / check reference" /></label>
        <button disabled={saving} className="rounded-md bg-amari-charcoal px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Record payout</button>
      </form>

      <form onSubmit={(event) => submit(event, 'correct')} className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold text-amari-charcoal">Correction or exception</h2>
        <p className="text-sm text-slate-600">The ledger is append-only. Record evidence instead of changing prior entries.</p>
        <label className={labelClass}>Ledger reward ID<input required name="rewardId" pattern="[A-Za-z0-9_-]+" className={inputClass} /></label>
        <label className={labelClass}>Event<select required name="correctionType" defaultValue="correction" className={inputClass}><option value="correction">Correction note</option><option value="refunded">Refunded</option><option value="disputed">Disputed</option><option value="voided">Voided</option><option value="expired">Expired</option></select></label>
        <label className={labelClass}>Evidence note<textarea required name="reason" rows={2} className={inputClass} /></label>
        <button disabled={saving} className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Record exception</button>
      </form>
    </section>

    {notice ? <p className="rounded-md bg-emerald-50 p-3 text-emerald-800" role="status">{notice}</p> : null}
    {error ? <p className="rounded-md bg-red-50 p-3 text-red-800" role="alert">{error}</p> : null}

    <section className="bg-white border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4"><h2 className="font-semibold text-amari-charcoal">Ledger history</h2><button type="button" onClick={() => void refresh()} disabled={loading} className="text-sm underline disabled:opacity-50">Refresh</button></div>
      {loading ? <p className="p-4">Loading ledger…</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Reward</th><th className="p-3">State</th><th className="p-3">Evidence</th><th className="p-3">Recorded by</th><th className="p-3">Time</th></tr></thead><tbody>{events.length ? events.map(e => <tr key={e.id} className="border-t align-top"><td className="p-3 font-mono">{e.reward_id}</td><td className="p-3 capitalize">{e.type.replace('_', ' ')}</td><td className="p-3 text-slate-600">{eventDetail(e)}</td><td className="p-3">{e.actor}</td><td className="p-3 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td></tr>) : <tr><td className="p-4 text-slate-500" colSpan={5}>No partner-reward events yet.</td></tr>}</tbody></table></div>}
    </section>
  </main>;
}
