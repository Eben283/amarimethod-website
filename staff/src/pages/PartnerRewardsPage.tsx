import { FormEvent, useCallback, useEffect, useState } from 'react';

type Reward = { rewardId: string; partnerName: string; partnerOrganization: string | null; referredName: string; referralAt: string | null; purchasedAt: string | null; sessionCount: number | null; amountCents: number | null; sessionEntitlement: string | null; holdUntil: string | null; status: 'chargeback_hold' | 'payable' | 'paid' | 'expired' | 'refunded' | 'disputed' | 'voided'; canRecordPayout: boolean; payoutReference: string | null; paidAt: string | null; corrected: boolean };
const inputClass = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm';
const labelClass = 'block text-sm font-medium text-slate-700';
const date = (value: string | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'not recorded';
const money = (cents: number | null) => cents === null ? 'amount needs review' : `$${(cents / 100).toLocaleString()}`;

export default function PartnerRewardsPage() {
  const [rewards, setRewards] = useState<Reward[]>([]);
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
      setRewards(body.rewards || []);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the partner-reward ledger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>, rewardId: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/staff-partner-rewards', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', rewardId, ...Object.fromEntries(fields.entries()) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not record partner-reward evidence');
      event.currentTarget.reset();
      setNotice('Payout record saved. No money was sent by this action.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record partner-reward evidence');
    } finally {
      setSaving(false);
    }
  }

  return <main className="max-w-6xl mx-auto p-6 space-y-6">
    <header>
      <p className="text-sm uppercase tracking-wide text-amari-accent-warm">Partner operations</p>
      <h1 className="text-3xl font-serif text-amari-charcoal">Partner rewards</h1>
      <p className="mt-2 max-w-3xl text-slate-600">Qualified referrals are shown as operational summaries. This page sends no messages and never initiates a payout; it can only record a completed manual payout after the chargeback hold.</p>
    </header>

    {notice ? <p className="rounded-md bg-emerald-50 p-3 text-emerald-800" role="status">{notice}</p> : null}
    {error ? <p className="rounded-md bg-red-50 p-3 text-red-800" role="alert">{error}</p> : null}

    <section className="space-y-4" aria-label="Partner reward summaries">
      <div className="flex items-center justify-between"><h2 className="font-semibold text-amari-charcoal">Reward status</h2><button type="button" onClick={() => void refresh()} disabled={loading} className="text-sm underline disabled:opacity-50">Refresh</button></div>
      {loading ? <p className="rounded-xl border bg-white p-4">Loading partner rewards…</p> : rewards.length ? rewards.map(reward => <article key={reward.rewardId} className="rounded-xl border bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-serif text-amari-charcoal">{reward.partnerName}{reward.partnerOrganization ? ` · ${reward.partnerOrganization}` : ''}</h3><p className="mt-1 text-slate-600">Referred {reward.referredName}: {date(reward.referralAt)}</p></div><span className={`rounded-full px-3 py-1 text-sm font-medium ${reward.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : reward.status === 'payable' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{reward.status === 'chargeback_hold' ? 'On chargeback hold' : reward.status === 'payable' ? 'Ready to record payout' : reward.status === 'paid' ? 'Paid' : reward.status.replace('_', ' ')}</span></div>
        <dl className="grid gap-3 text-sm md:grid-cols-2"><div><dt className="text-slate-500">Qualifying purchase</dt><dd className="font-medium">{reward.sessionCount ? `${reward.sessionCount}-session Practice` : 'Purchase needs review'}, {date(reward.purchasedAt)}</dd></div><div><dt className="text-slate-500">Reward</dt><dd className="font-medium">{money(reward.amountCents)}{reward.sessionEntitlement ? ` cash + ${reward.sessionEntitlement}` : ''}</dd></div><div><dt className="text-slate-500">Chargeback hold ends</dt><dd className="font-medium">{date(reward.holdUntil)}</dd></div><div><dt className="text-slate-500">Payout status</dt><dd className="font-medium">{reward.status === 'paid' ? `Paid${reward.payoutReference ? ` · ${reward.payoutReference}` : ''}` : 'Not paid; no payout reference recorded'}</dd></div></dl>
        {reward.canRecordPayout ? <form onSubmit={(event) => submit(event, reward.rewardId)} className="rounded-lg bg-amber-50 p-4 space-y-3"><p className="text-sm text-amber-950">Record a completed manual payout only. This does not send money.</p><label className={labelClass}>Payout reference<input required name="payoutReference" className={inputClass} placeholder="bank transfer / check reference" /></label><button disabled={saving} className="rounded-md bg-amari-charcoal px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Record completed payout</button></form> : null}
      </article>) : <p className="rounded-xl border bg-white p-4 text-slate-500">No partner rewards have been recorded yet.</p>}
    </section>
  </main>;
}
