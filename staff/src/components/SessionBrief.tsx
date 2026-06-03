import type { ContactDetail } from '../types/staff';

interface Props {
  client: ContactDetail;
}

const NON_SESSION = /pain assessment|discovery call|15-minute|15 minute|consultation/i;

/** Completed in-person sessions (excludes discovery/assessment calls), newest first. */
export function completedSessions(client: ContactDetail) {
  return client.appointments.filter(
    (a) => (a.status === 'showed' || a.status === 'completed') && !NON_SESSION.test(a.title),
  );
}

export function visitLabel(client: ContactDetail): string {
  const visitCount = completedSessions(client).length;
  if (visitCount === 0) return 'First visit';
  if (visitCount === 1) return '2nd visit';
  return `${ordinal(visitCount + 1)} visit`;
}

/** Single source of truth for the 30-second pre-session read. */
export function buildSessionBrief(client: ContactDetail): string {
  const fullName = [client.firstName, client.lastName].filter(Boolean).join(' ');
  const isPartner = client.tags.includes('affiliate-partner');
  const completedAppts = completedSessions(client);

  const lastSession = completedAppts[0];
  const lastSessionStr = lastSession
    ? `Last session (${formatShortDate(lastSession.startTime)}): ${cleanTitle(lastSession.title, fullName)}`
    : null;

  const quiz = client.quizResults;
  const quizStr = quiz
    ? `Primary issue: ${quiz.primaryPainLocation || 'unknown'}${quiz.painDuration ? `, ${quiz.painDuration}` : ''}${quiz.painTrigger ? ` (${quiz.painTrigger.toLowerCase()})` : ''}`
    : null;

  const treatmentStr = quiz?.treatmentsTried
    ? `Tried: ${quiz.treatmentsTried}${quiz.treatmentResults ? ` — ${quiz.treatmentResults.toLowerCase()}` : ''}`
    : null;

  const lastNote = client.notes[0];
  const noteStr = lastNote ? `Last note: "${truncate(lastNote.body, 80)}"` : null;

  const parts: string[] = [];
  const roleStr = isPartner ? 'Referral partner' : '';
  const seriesStr = client.seriesType !== 'none' ? `on a ${client.seriesType}` : '';
  const intro = [fullName, roleStr, visitLabel(client), seriesStr].filter(Boolean).join(', ');
  parts.push(intro + '.');

  if (lastSessionStr) parts.push(lastSessionStr + '.');
  if (quizStr) parts.push(quizStr + '.');
  if (treatmentStr) parts.push(treatmentStr + '.');
  if (noteStr) parts.push(noteStr);

  if (parts.length <= 1 && !quiz) {
    parts.push('No quiz results or session notes yet.');
  }
  return parts.join(' ');
}

export default function SessionBrief({ client }: Props) {
  return (
    <div className="staff-card bg-amari-charcoal text-white">
      <h3 className="text-xs font-medium text-amari-accent-warm mb-2 uppercase tracking-wide">
        Session Brief
      </h3>
      <p className="text-sm leading-relaxed">{buildSessionBrief(client)}</p>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function cleanTitle(title: string, clientName: string): string {
  if (title.toLowerCase() === clientName.toLowerCase()) return 'Session';
  return title
    .replace(/Amari Method /i, '')
    .replace(/ session with .*/i, '')
    .replace(/ appointment with .*/i, '');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '...';
}
