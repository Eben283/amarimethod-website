import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarClock, Check, Loader2, Plus, RotateCcw, Search, X } from 'lucide-react';
import {
  ApiError,
  createOwnedFollowup,
  getOwnedFollowups,
  searchContacts,
  setOwnedFollowupComplete,
  type OwnedFollowup,
} from '../lib/api';
import type { ContactListItem } from '../types/staff';

function todayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dueLabel(dueOn: string) {
  const today = todayDate();
  if (dueOn === today) return { label: 'Today', tone: 'text-amber-800 bg-amber-50 border-amber-200' };
  const date = new Date(`${dueOn}T12:00:00`);
  const label = Number.isNaN(date.getTime())
    ? dueOn
    : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return dueOn < today
    ? { label: `Overdue · ${label}`, tone: 'text-red-700 bg-red-50 border-red-200' }
    : { label, tone: 'text-amari-text-muted bg-white border-amari-border' };
}

export default function OwnedFollowupsPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [items, setItems] = useState<OwnedFollowup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<ContactListItem[]>([]);
  const [selected, setSelected] = useState<ContactListItem | null>(null);
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState(todayDate());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState<OwnedFollowup | null>(null);

  const handleError = useCallback((failure: unknown, fallback: string) => {
    if (failure instanceof ApiError && failure.status === 401) {
      onUnauthorized();
      return;
    }
    setError(failure instanceof Error ? failure.message : fallback);
  }, [onUnauthorized]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getOwnedFollowups();
      setItems(response.followups || []);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        onUnauthorized();
      } else {
        const detail = failure instanceof Error ? failure.message : 'Dated follow-ups could not be loaded.';
        setError(`${detail} The outreach list below is still available.`);
      }
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => { void load(); }, [load]);

  async function runSearch() {
    const clean = query.trim();
    if (clean.length < 2) {
      setError('Enter at least two letters, a phone number, or an email.');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      setMatches(await searchContacts(clean));
    } catch (failure) {
      handleError(failure, 'People search failed.');
    } finally {
      setSearching(false);
    }
  }

  function resetForm() {
    setShowForm(false);
    setQuery('');
    setMatches([]);
    setSelected(null);
    setTitle('');
    setDueOn(todayDate());
  }

  async function save() {
    if (!selected || !title.trim() || !dueOn) {
      setError('Choose a person, a due date, and what needs to happen.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await createOwnedFollowup({ contactId: selected.id, title: title.trim(), dueOn });
      setItems((current) => [...current, response.followup].sort((a, b) => a.dueOn.localeCompare(b.dueOn)));
      resetForm();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        onUnauthorized();
      } else if (failure instanceof ApiError && failure.status === 404) {
        setError('That person is not in the CRM mirror yet. Open Operations → CRM Mirror, refresh it, then try again.');
      } else {
        handleError(failure, 'Follow-up could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function complete(item: OwnedFollowup) {
    setBusyId(item.id);
    setError(null);
    try {
      await setOwnedFollowupComplete(item.id, true);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setJustCompleted(item);
    } catch (failure) {
      handleError(failure, 'Follow-up could not be completed.');
    } finally {
      setBusyId(null);
    }
  }

  async function reopen() {
    if (!justCompleted) return;
    setBusyId(justCompleted.id);
    setError(null);
    try {
      const response = await setOwnedFollowupComplete(justCompleted.id, false);
      setItems((current) => [...current, response.followup].sort((a, b) => a.dueOn.localeCompare(b.dueOn)));
      setJustCompleted(null);
    } catch (failure) {
      handleError(failure, 'Follow-up could not be reopened.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mb-4 rounded-2xl border border-amari-border bg-white p-3 shadow-sm" aria-labelledby="owned-followups-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="owned-followups-title" className="flex items-center gap-2 text-sm font-semibold text-amari-charcoal">
            <CalendarClock className="h-4 w-4 text-amari-accent-warm" /> Dated follow-ups
          </h2>
          <p className="mt-0.5 text-[11px] text-amari-text-muted">Your reminder only. Saving or completing one does not contact the person.</p>
        </div>
        <button
          type="button"
          onClick={() => { setShowForm((open) => !open); setError(null); }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amari-charcoal px-2.5 py-1.5 text-xs font-medium text-amari-charcoal hover:bg-amari-light-sand"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? 'Close' : 'Add'}
        </button>
      </div>

      {showForm && (
        <div className="mt-3 space-y-2 rounded-xl border border-amari-border bg-amari-light-sand/40 p-3">
          {selected ? (
            <div className="flex items-center justify-between rounded-lg border border-amari-border bg-white px-3 py-2 text-sm">
              <span className="font-medium text-amari-charcoal">{selected.name || selected.email || selected.phone}</span>
              <button type="button" onClick={() => setSelected(null)} className="text-xs text-amari-text-muted hover:text-amari-charcoal">Change</button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch(); } }}
                  placeholder="Find a person…"
                  className="min-w-0 flex-1 rounded-lg border border-amari-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amari-accent-warm"
                />
                <button type="button" onClick={() => void runSearch()} disabled={searching} className="rounded-lg border border-amari-charcoal px-3 text-amari-charcoal disabled:opacity-50">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </button>
              </div>
              {matches.length > 0 && (
                <div className="max-h-40 divide-y divide-amari-border overflow-y-auto rounded-lg border border-amari-border bg-white">
                  {matches.map((contact) => (
                    <button key={contact.id} type="button" onClick={() => { setSelected(contact); setMatches([]); }} className="block w-full px-3 py-2 text-left hover:bg-amari-light-sand">
                      <span className="block text-sm font-medium text-amari-charcoal">{contact.name || 'Unnamed person'}</span>
                      <span className="block truncate text-[11px] text-amari-text-muted">{contact.email || contact.phone || 'No contact details mirrored'}</span>
                    </button>
                  ))}
                </div>
              )}
              {!searching && query.trim().length >= 2 && matches.length === 0 && (
                <p className="text-[11px] text-amari-text-muted">Run the search to choose a person. If nobody appears, try their email or phone.</p>
              )}
            </>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value.slice(0, 280))}
              placeholder="What needs to happen?"
              maxLength={280}
              className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amari-accent-warm"
            />
            <input
              type="date"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              className="rounded-lg border border-amari-border bg-white px-3 py-2 text-sm text-amari-charcoal focus:outline-none focus:ring-1 focus:ring-amari-accent-warm"
            />
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-amari-charcoal px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save follow-up
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {justCompleted && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span>Completed “{justCompleted.title}”.</span>
          <button type="button" onClick={() => void reopen()} disabled={busyId === justCompleted.id} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
            <RotateCcw className="h-3 w-3" /> Undo
          </button>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-amari-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading dated follow-ups…</div>
        ) : items.length === 0 && !error ? (
          <p className="rounded-lg bg-amari-light-sand/50 px-3 py-3 text-xs text-amari-text-muted">No dated follow-ups are open. Add one when somebody needs a specific future check-in.</p>
        ) : (
          items.map((item) => {
            const due = dueLabel(item.dueOn);
            return (
              <div key={item.id} className="flex items-start gap-2 rounded-xl border border-amari-border px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => void complete(item)}
                  disabled={busyId === item.id}
                  aria-label={`Complete ${item.title}`}
                  className="mt-0.5 rounded-full border border-amari-charcoal p-1 text-amari-charcoal hover:bg-amari-light-sand disabled:opacity-50"
                >
                  {busyId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-amari-charcoal">{item.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <Link to={`/client-desk?contact=${encodeURIComponent(item.contactId)}`} className="font-medium text-amari-charcoal underline underline-offset-2">{item.contactName}</Link>
                    <span className={`rounded-full border px-1.5 py-0.5 ${due.tone}`}>{due.label}</span>
                    <span className="text-amari-text-muted">set by {item.createdBy}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
