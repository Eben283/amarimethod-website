import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CarFront, LogOut, Send } from 'lucide-react';
import { useParkingAuth } from '../contexts/ParkingAuthContext';
import { getCurrentParking, sendParkingMessage } from '../lib/parking-api';
import ParkingHome from '../components/ParkingHome';
import type { ParkingSnapshot } from '../types/cos';

export default function ParkingPage() {
  const { logout } = useParkingAuth();
  const [parking, setParking] = useState<ParkingSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState('');
  const [reply, setReply] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadParking = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setParking(await getCurrentParking());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load saved parking.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadParking(); }, [loadParking]);

  const recordParking = useCallback((event: FormEvent) => {
    event.preventDefault();
    const message = entry.trim();
    if (!message || isSaving) return;
    setIsSaving(true);
    setReply('');
    let response = '';
    void sendParkingMessage(
      message,
      chunk => { response += chunk; setReply(response); },
      () => { setEntry(''); setIsSaving(false); void loadParking(); },
      messageError => { setReply(messageError); setIsSaving(false); },
    );
  }, [entry, isSaving, loadParking]);

  return (
    <div className="min-h-screen min-h-[100dvh] bg-cos-bg text-cos-text">
      <header className="flex items-center justify-between px-4 pb-3 pt-14 border-b border-cos-border">
        <div className="flex items-center gap-2"><CarFront className="w-5 h-5 text-cos-accent" /><h1 className="text-base font-semibold">Parking</h1></div>
        <button onClick={logout} className="cos-btn-ghost" title="Sign out"><LogOut className="w-5 h-5" /></button>
      </header>
      <main className="px-4 py-4 pb-32">
        <ParkingHome parking={parking} isLoading={isLoading} error={error} onRefresh={() => void loadParking()} />
        <section className="mx-auto mt-2 w-full max-w-[35rem] border-t border-cos-border pt-4" aria-label="Parking workflow">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-cos-text-muted">Parking checklist</p>
          <ol className="mt-2 grid gap-2 text-sm text-cos-text-secondary">
            <li>1. Save the exact address and curb side.</li>
            <li>2. Match the block’s City and saved rules.</li>
            <li>3. Replace the prior move-car Calendar event.</li>
          </ol>
        </section>
        {reply && <p className="mx-auto mt-2 w-full max-w-[35rem] whitespace-pre-wrap text-sm leading-6 text-cos-text-secondary">{reply}</p>}
      </main>
      <form onSubmit={recordParking} className="fixed bottom-0 left-0 right-0 border-t border-cos-border bg-cos-bg px-4 py-3 safe-bottom">
        <div className="mx-auto flex w-full max-w-[35rem] gap-2">
          <input value={entry} onChange={event => setEntry(event.target.value)} className="cos-input" placeholder="I parked at 727 10th Ave" aria-label="Where did you park?" disabled={isSaving} />
          <button type="submit" className="cos-btn-accent shrink-0" disabled={!entry.trim() || isSaving} aria-label="Save parking"><Send className="w-5 h-5" /></button>
        </div>
      </form>
    </div>
  );
}
