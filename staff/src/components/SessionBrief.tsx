import type { ContactDetail } from '../types/staff';

interface Props {
  client: ContactDetail;
}

export default function SessionBrief({ client }: Props) {
  const fullName = [client.firstName, client.lastName].filter(Boolean).join(' ');
  const isPartner = client.tags.includes('affiliate-partner');

  // Count completed/showed sessions (exclude discovery calls, pain assessments)
  const nonSession = /pain assessment|discovery call|15-minute|15 minute|consultation/i;
  const completedAppts = client.appointments.filter(
    (a) => (a.status === 'showed' || a.status === 'completed') && !nonSession.test(a.title)
  );
  const visitCount = completedAppts.length;
  const visitLabel = visitCount === 0
    ? 'First visit'
    : visitCount === 1
    ? '2nd visit'
    : `${ordinal(visitCount + 1)} visit`;

  // Last session info
  const lastSession = completedAppts[0]; // sorted newest-first
  const lastSessionStr = lastSession
    ? `Last session (${formatShortDate(lastSession.startTime)}): ${cleanTitle(lastSession.title, fullName)}`
    : null;

  // Quiz summary
  const quiz = client.quizResults;
  const quizStr = quiz
    ? `Primary issue: ${quiz.primaryPainLocation || 'unknown'}${quiz.painDuration ? `, ${quiz.painDuration}` : ''}${quiz.painTrigger ? ` (${quiz.painTrigger.toLowerCase()})` : ''}`
    : null;

  // Treatments
  const treatmentStr = quiz?.treatmentsTried
    ? `Tried: ${quiz.treatmentsTried}${quiz.treatmentResults ? ` — ${quiz.treatmentResults.toLowerCase()}` : ''}`
    : null;

  // Most recent note
  const lastNote = client.notes[0];
  const noteStr = lastNote
    ? `Last note: "${truncate(lastNote.body, 80)}"`
    : null;

  // Build the brief
  const parts: string[] = [];

  // Opening line: who they are
  const roleStr = isPartner ? 'Referral partner' : '';
  const seriesStr = client.seriesType !== 'none'
    ? `on a ${client.seriesType}`
    : '';
  const intro = [fullName, roleStr, visitLabel, seriesStr]
    .filter(Boolean)
    .join(', ');
  parts.push(intro + '.');

  if (lastSessionStr) parts.push(lastSessionStr + '.');
  if (quizStr) parts.push(quizStr + '.');
  if (treatmentStr) parts.push(treatmentStr + '.');
  if (noteStr) parts.push(noteStr);

  if (parts.length <= 1 && !quiz) {
    parts.push('No quiz results or session notes yet.');
  }

  return (
    <div className="staff-card bg-amari-charcoal text-white">
      <h3 className="text-xs font-medium text-amari-accent-warm mb-2 uppercase tracking-wide">
        Session Brief
      </h3>
      <p className="text-sm leading-relaxed">
        {parts.join(' ')}
      </p>
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
  // Remove client name from title if it's just their name
  if (title.toLowerCase() === clientName.toLowerCase()) return 'Session';
  // Remove common prefixes for brevity
  return title
    .replace(/Amari Method /i, '')
    .replace(/ session with .*/i, '')
    .replace(/ appointment with .*/i, '');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '...';
}
