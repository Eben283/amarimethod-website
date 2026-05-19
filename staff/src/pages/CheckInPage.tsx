import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getContactDetail, staffCheckIn, ApiError } from '../lib/api';
import type { ContactDetail } from '../types/staff';
import SignaturePad from '../components/SignaturePad';

// iPad check-in page. Garrett hands the iPad to the client when they arrive
// for their first session. Client signs the practice policies; the signature
// + typed name + agreement-version + timestamp are recorded server-side as
// the legal attestation record.

export default function CheckInPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [client, setClient] = useState<ContactDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [typedName, setTypedName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      setIsLoading(true);
      try {
        const data = await getContactDetail(id, false);
        if (!cancelled) {
          setClient(data);
          // Pre-fill typed name with client's name as a starting point.
          const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim();
          if (fullName) setTypedName(fullName);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load client');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, logout]);

  const canSubmit =
    typedName.trim().length >= 2 &&
    signature !== null &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit || !id || !signature) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await staffCheckIn(id, {
        typedName: typedName.trim(),
        signatureImage: signature,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setSubmitError(err instanceof Error ? err.message : 'Failed to save signature');
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-amari-charcoal mb-4">{loadError}</p>
          <button onClick={() => navigate('/')} className="portal-btn-secondary">Back</button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-amari-light-sand">
        <div className="staff-card max-w-md w-full text-center">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
          <h1 className="text-xl font-serif text-amari-charcoal mb-2">Thank you, {typedName}</h1>
          <p className="text-sm text-amari-charcoal/80 mb-6">
            Your signature has been recorded. You're all set for your session.
          </p>
          <button
            onClick={() => navigate(`/client/${id}`, { replace: true })}
            className="portal-btn-secondary w-full min-h-[44px]"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-amari-light-sand">
      <header className="sticky top-0 bg-white border-b border-amari-border z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-amari-charcoal min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold text-amari-charcoal">Check in</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <section className="staff-card">
          <p className="text-xs font-semibold text-amari-text-muted uppercase tracking-wider mb-1">
            Welcome
            {client && (client.firstName || client.lastName) && (
              <span>, {client.firstName} {client.lastName}</span>
            )}
          </p>
          <h2 className="text-lg font-serif text-amari-charcoal">Practice policies</h2>
          <p className="text-sm text-amari-charcoal/80 leading-relaxed mt-2">
            Before your first session, please review and sign the practice policies. This is a
            quick formality — about 2 minutes.
          </p>
        </section>

        <section className="staff-card">
          <h3 className="text-sm font-semibold text-amari-charcoal mb-2">What you're agreeing to</h3>
          <p className="text-sm text-amari-charcoal/80 leading-relaxed mb-3">
            By signing below, you confirm that you have read and agree to both documents:
          </p>
          <ul className="space-y-2 text-sm">
            <li>
              <a
                href="/client-info"
                className="text-amari-accent-warm underline underline-offset-2"
              >
                Missed Appointment Policy →
              </a>
            </li>
            <li>
              <a
                href="/member-agreement"
                className="text-amari-accent-warm underline underline-offset-2"
              >
                Practice Member Agreement →
              </a>
            </li>
          </ul>
          <p className="text-xs text-amari-text-muted mt-3">
            Tap a link to open the full text in a new tab.
          </p>
        </section>

        <section className="staff-card">
          <h3 className="text-sm font-semibold text-amari-charcoal mb-3">Your signature</h3>

          <label className="block mb-4">
            <span className="text-xs font-medium text-amari-text-muted uppercase tracking-wider">
              Full name
            </span>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name"
              className="mt-1 w-full px-3 py-3 border border-amari-border rounded-lg text-amari-charcoal focus:outline-none focus:border-amari-accent-warm min-h-[44px]"
              autoComplete="name"
            />
          </label>

          <span className="text-xs font-medium text-amari-text-muted uppercase tracking-wider">
            Signature
          </span>
          <SignaturePad onChange={setSignature} className="mt-1 mb-2" />
          <p className="text-xs text-amari-text-muted leading-relaxed">
            By signing above, I confirm I have read and agree to the Missed Appointment Policy
            and the Practice Member Agreement.
          </p>
        </section>

        {submitError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {submitError}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`w-full flex items-center justify-center gap-2 px-4 py-4 rounded-lg text-base font-medium transition-all min-h-[52px] ${
            canSubmit
              ? 'bg-amari-charcoal text-white hover:bg-black active:bg-black'
              : 'bg-amari-border text-amari-text-muted cursor-not-allowed'
          }`}
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" /> Saving signature...
            </>
          ) : (
            'Sign and continue'
          )}
        </button>
      </main>
    </div>
  );
}
