import {
  AlertCircle,
  BellRing,
  Check,
  Clock3,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquareText,
  Save,
  ShieldCheck,
  Smartphone,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  type CommunicationCategoryPreference,
  type CommunicationChannel,
  type CommunicationCurrentRoute,
  type TeamCommunicationPreferences,
  type TeamCommunicationPreferencesResponse,
  getTeamCommunicationPreferences,
  saveTeamCommunicationPreferences,
} from '../lib/api';
import '../styles/communication-preferences.css';

const CHANNEL_COPY: Record<CommunicationChannel, { label: string; Icon: typeof BellRing }> = {
  in_app: { label: 'In Staff', Icon: BellRing },
  email: { label: 'Email', Icon: Mail },
  sms: { label: 'SMS', Icon: Smartphone },
};

const TIMEZONES = [
  ['America/Los_Angeles', 'Pacific time'],
  ['America/Denver', 'Mountain time'],
  ['America/Chicago', 'Central time'],
  ['America/New_York', 'Eastern time'],
];

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return 'Communication preferences could not be loaded. Refresh and try again.';
}

function updatedLabel(value: string | null) {
  if (!value) return 'Using audited current-route defaults';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Saved preference on file'
    : `Preference saved ${date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function CategoryCard({
  route,
  value,
  onChange,
}: {
  route: CommunicationCurrentRoute;
  value: CommunicationCategoryPreference;
  onChange: (next: CommunicationCategoryPreference) => void;
}) {
  return (
    <article className="comm-route-card">
      <div className="comm-route-card__head">
        <div>
          <span className="comm-route-card__owner">{route.currentOwner}</span>
          <h2>{route.label}</h2>
          <p>{route.description}</p>
        </div>
        <label className="comm-switch">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          />
          <span aria-hidden="true"><i /></span>
          <b>{value.enabled ? 'Wanted' : 'Not wanted'}</b>
        </label>
      </div>

      <div className="comm-route-card__route">
        <span><i aria-hidden="true" /> Live now · read only</span>
        <strong>{route.currentRoute}</strong>
        <small>{route.currentCadence === 'digest' ? 'Scheduled summary' : 'Sent when a new incident opens'}</small>
      </div>

      <div className="comm-route-card__plan">
        <div className="comm-route-card__channels" aria-label={`${route.label} channel preferences`}>
          {(Object.keys(CHANNEL_COPY) as CommunicationChannel[]).map((channel) => {
            const { Icon, label } = CHANNEL_COPY[channel];
            const status = route.channels[channel];
            return (
              <label key={channel} className={`comm-channel comm-channel--${status}`}>
                <input
                  type="checkbox"
                  checked={value.channels[channel]}
                  disabled={!value.enabled}
                  onChange={(event) => onChange({
                    ...value,
                    channels: { ...value.channels, [channel]: event.target.checked },
                  })}
                />
                <Icon aria-hidden="true" />
                <span><b>{label}</b><small>{status === 'live' ? 'Live route' : status === 'surface_only' ? 'View only — no alert delivery' : 'Not wired for this event'}</small></span>
                {value.channels[channel] ? <Check aria-hidden="true" /> : null}
              </label>
            );
          })}
        </div>

        <label className="comm-field comm-field--cadence">
          <span>Timing preference</span>
          <select
            value={value.cadence}
            disabled={!value.enabled}
            onChange={(event) => onChange({ ...value, cadence: event.target.value as 'immediate' | 'digest' })}
          >
            <option value="immediate">Immediate</option>
            <option value="digest">Digest</option>
          </select>
        </label>
      </div>
    </article>
  );
}

export default function CommunicationPreferencesPage() {
  const [data, setData] = useState<TeamCommunicationPreferencesResponse | null>(null);
  const [preferences, setPreferences] = useState<TeamCommunicationPreferences | null>(null);
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    let current = true;
    void getTeamCommunicationPreferences()
      .then((response) => {
        if (!current) return;
        setData(response);
        setPreferences(response.preferences);
        setBaseline(JSON.stringify(response.preferences));
      })
      .catch((requestError) => { if (current) setError(errorMessage(requestError)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  const dirty = useMemo(() => preferences ? JSON.stringify(preferences) !== baseline : false, [baseline, preferences]);

  useEffect(() => {
    if (dirty) setSavedNotice(false);
  }, [dirty]);

  function updateCategory(id: string, next: CommunicationCategoryPreference) {
    setSavedNotice(false);
    setPreferences((current) => current ? {
      ...current,
      categories: { ...current.categories, [id]: next },
    } : current);
  }

  async function save() {
    if (!preferences || !data?.storageAvailable) return;
    setSaving(true);
    setError('');
    setSavedNotice(false);
    try {
      const response = await saveTeamCommunicationPreferences(preferences);
      setData(response);
      setPreferences(response.preferences);
      setBaseline(JSON.stringify(response.preferences));
      setSavedNotice(true);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="comm-prefs comm-prefs--state" aria-busy="true"><Loader2 aria-hidden="true" /><p>Opening team communication preferences…</p></main>;
  }

  if (!data || !preferences) {
    return <main className="comm-prefs comm-prefs--state"><AlertCircle aria-hidden="true" /><h1>Preferences are unavailable</h1><p>{error}</p></main>;
  }

  const otherStaff = data.user === 'Eben' ? 'Garrett' : 'Eben';

  return (
    <main className="comm-prefs">
      <header className="comm-prefs__masthead">
        <div className="comm-prefs__eyebrow"><BellRing aria-hidden="true" /> Team communication</div>
        <div className="comm-prefs__title-row">
          <div>
            <h1>Choose what should reach you.</h1>
            <p>Signed in as <strong>{data.user}</strong>. These choices belong only to your Staff account.</p>
          </div>
          <span className="comm-prefs__identity"><UsersRound aria-hidden="true" /> {data.user}</span>
        </div>
      </header>

      <section className="comm-prefs__boundary" aria-labelledby="delivery-boundary-title">
        <ShieldCheck aria-hidden="true" />
        <div>
          <h2 id="delivery-boundary-title">Current delivery stays exactly as it is</h2>
          <p>This page records preferences for cutover. Saving here does not redirect, suppress, schedule, escalate, or send anything yet.</p>
        </div>
        <span>Foundation only</span>
      </section>

      {!data.storageAvailable ? (
        <div className="comm-prefs__error" role="alert"><AlertCircle aria-hidden="true" />Preference storage is not configured. You can review current routes, but saving is unavailable.</div>
      ) : null}
      {error ? <div className="comm-prefs__error" role="alert"><AlertCircle aria-hidden="true" />{error}</div> : null}
      {savedNotice ? <div className="comm-prefs__saved" role="status"><Check aria-hidden="true" />Preference saved. Live delivery was not changed.</div> : null}

      <section className="comm-prefs__section" aria-labelledby="event-routes-title">
        <div className="comm-prefs__section-head">
          <div><span>01 · Event routes</span><h2 id="event-routes-title">Live route beside future intent</h2></div>
          <p>{updatedLabel(data.updatedAt)}</p>
        </div>
        <div className="comm-prefs__routes">
          {data.currentRoutes.map((route) => (
            <CategoryCard key={route.id} route={route} value={preferences.categories[route.id]} onChange={(next) => updateCategory(route.id, next)} />
          ))}
        </div>
      </section>

      <section className="comm-prefs__section comm-prefs__two-up" aria-label="Time and fallback preferences">
        <article className="comm-settings-card">
          <div className="comm-settings-card__head"><Clock3 aria-hidden="true" /><div><span>02 · Time</span><h2>Quiet hours and timezone</h2></div></div>
          <label className="comm-checkline">
            <input
              type="checkbox"
              checked={preferences.quietHours.enabled}
              onChange={(event) => setPreferences({ ...preferences, quietHours: { ...preferences.quietHours, enabled: event.target.checked } })}
            />
            <span><b>Use quiet hours after cutover</b><small>Currently off, so existing delivery is never held.</small></span>
          </label>
          <div className="comm-time-grid">
            <label className="comm-field"><span>Start</span><input type="time" value={preferences.quietHours.start} disabled={!preferences.quietHours.enabled} onChange={(event) => setPreferences({ ...preferences, quietHours: { ...preferences.quietHours, start: event.target.value } })} /></label>
            <label className="comm-field"><span>End</span><input type="time" value={preferences.quietHours.end} disabled={!preferences.quietHours.enabled} onChange={(event) => setPreferences({ ...preferences, quietHours: { ...preferences.quietHours, end: event.target.value } })} /></label>
          </div>
          <label className="comm-field"><span>Timezone</span><select value={preferences.timezone} onChange={(event) => setPreferences({ ...preferences, timezone: event.target.value })}>{TIMEZONES.map(([value, label]) => <option key={value} value={value}>{label} · {value}</option>)}</select></label>
        </article>

        <article className="comm-settings-card">
          <div className="comm-settings-card__head"><MessageSquareText aria-hidden="true" /><div><span>03 · Fallback</span><h2>Escalation preference</h2></div></div>
          <label className="comm-checkline">
            <input
              type="checkbox"
              checked={preferences.escalation.enabled}
              onChange={(event) => setPreferences({
                ...preferences,
                escalation: {
                  ...preferences.escalation,
                  enabled: event.target.checked,
                  fallbackStaff: event.target.checked ? otherStaff : preferences.escalation.fallbackStaff,
                  fallbackChannel: event.target.checked ? (preferences.escalation.fallbackChannel || 'sms') : preferences.escalation.fallbackChannel,
                },
              })}
            />
            <span><b>Record an escalation preference</b><small>No fallback or acknowledgement timer is running today.</small></span>
          </label>
          <div className="comm-time-grid">
            <label className="comm-field"><span>After</span><select disabled={!preferences.escalation.enabled} value={preferences.escalation.afterMinutes} onChange={(event) => setPreferences({ ...preferences, escalation: { ...preferences.escalation, afterMinutes: Number(event.target.value) } })}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option></select></label>
            <label className="comm-field"><span>Ask</span><select disabled={!preferences.escalation.enabled} value={preferences.escalation.fallbackStaff || ''} onChange={(event) => setPreferences({ ...preferences, escalation: { ...preferences.escalation, fallbackStaff: event.target.value || null } })}><option value="">No one</option><option value={otherStaff}>{otherStaff}</option></select></label>
          </div>
          <label className="comm-field"><span>Fallback channel</span><select disabled={!preferences.escalation.enabled} value={preferences.escalation.fallbackChannel || ''} onChange={(event) => setPreferences({ ...preferences, escalation: { ...preferences.escalation, fallbackChannel: (event.target.value || null) as 'sms' | 'email' | null } })}><option value="">None</option><option value="sms">SMS</option><option value="email">Email</option></select></label>
          <p className="comm-settings-card__note">This captures the desired fallback only. It does not prove the alternate destination is configured or reachable.</p>
        </article>
      </section>

      <section className="comm-prefs__section comm-prefs__external" aria-labelledby="external-title">
        <div className="comm-prefs__section-head"><div><span>04 · Outside this control</span><h2 id="external-title">Provider-managed staff notices</h2></div><p>Visible here so the system is not hidden.</p></div>
        <div className="comm-prefs__external-grid">
          {data.externalRoutes.map((route) => <article key={route.id}><ExternalLink aria-hidden="true" /><div><h3>{route.label}</h3><p>{route.currentRoute}</p></div><span>Not controlled here</span></article>)}
        </div>
      </section>

      <footer className="comm-prefs__savebar">
        <div><strong>{dirty ? 'Unsaved preference changes' : 'Preferences up to date'}</strong><small>Live communication remains unchanged until a separately reviewed cutover.</small></div>
        <button type="button" onClick={() => void save()} disabled={!dirty || saving || !data.storageAvailable}>{saving ? <Loader2 className="is-spinning" aria-hidden="true" /> : <Save aria-hidden="true" />}{saving ? 'Saving…' : 'Save preferences'}</button>
      </footer>
    </main>
  );
}
