import type { ContactDetail, ChecklistTemplate, ChecklistItem, QuizResults } from '../types/staff';

interface SessionContext {
  firstName: string;
  visitCount: number;
  lastSession: { title: string; startTime: string } | null;
  daysSinceLast: number | null;
  nextAppt: { title: string; startTime: string } | null;
  daysUntilNext: number | null;
  firstSession: { startTime: string } | null;
  quiz: QuizResults | null;
  lastNote: { body: string } | null;
  totalDaysSpan: number | null;
  seriesType: string;
  sessionsRemaining: number;
}

export function generateChecklist(client: ContactDetail): ChecklistTemplate | null {
  const isPartner = client.tags.includes('affiliate-partner');

  const completed = client.appointments.filter(
    (a) => a.status === 'showed' || a.status === 'completed'
  );

  // Previous sessions = completed but not today
  const today = new Date().toDateString();
  const previous = completed.filter(
    (a) => new Date(a.startTime).toDateString() !== today
  );
  const lastSession = previous[0] || null;
  const firstSession = completed.length > 0 ? completed[completed.length - 1] : null;

  const future = client.appointments.filter(
    (a) => a.status === 'confirmed' && new Date(a.startTime) > new Date()
  );
  const nextAppt = future[0] || null;

  const daysSinceLast = lastSession ? daysBetween(new Date(lastSession.startTime), new Date()) : null;
  const daysUntilNext = nextAppt ? daysBetween(new Date(), new Date(nextAppt.startTime)) : null;
  const totalDaysSpan = firstSession ? daysBetween(new Date(firstSession.startTime), new Date()) : null;

  const ctx: SessionContext = {
    firstName: client.firstName,
    visitCount: completed.length,
    lastSession,
    daysSinceLast,
    nextAppt,
    daysUntilNext,
    firstSession,
    quiz: client.quizResults,
    lastNote: client.notes[0] || null,
    totalDaysSpan,
    seriesType: client.seriesType,
    sessionsRemaining: client.sessionsRemaining,
  };

  if (isPartner) return buildPartner(ctx);
  if (ctx.visitCount === 0) return buildNewClient(ctx);
  if (daysSinceLast && daysSinceLast > 21) return buildReturning(ctx);
  if (client.sessionsRemaining <= 1 && client.seriesType !== 'none') return buildEndOfPackage(ctx);
  if (ctx.visitCount <= 3) return buildEarly(ctx);
  return buildOngoing(ctx);
}

// ── Builder functions ──

function buildNewClient(ctx: SessionContext): ChecklistTemplate {
  const { firstName, quiz } = ctx;
  const items: ChecklistItem[] = [];

  if (quiz) {
    items.push(item('quiz-review', 'operational',
      `Review ${firstName}'s quiz results together`,
      `${quiz.patternSignature} pattern. ${quiz.primaryPainLocation || 'Unknown'} pain, ${quiz.painDuration || 'unknown duration'}. Recovery potential: ${quiz.recoveryPotentialScore || '?'}%.`
    ));

    if (quiz.treatmentsTried) {
      items.push(item('treatments', 'conversational',
        `Acknowledge what they've already tried`,
        `They've done ${quiz.treatmentsTried}${quiz.treatmentResults ? ` with ${quiz.treatmentResults.toLowerCase()}` : ''}. Validate that, then explain how this is different — you're looking at the whole pattern, not just the symptom.`
      ));
    }
  } else {
    items.push(item('ask-concern', 'conversational',
      `Ask ${firstName} what brought them in — listen before assessing`,
      `No quiz on file. Let them tell you in their own words. You'll learn more from how they describe it than from a form.`
    ));
  }

  items.push(item('introduce', 'operational',
    'Introduce the Amari Method — active vs passive system',
    `"Your body has muscles working too hard because others aren't working enough. We find those and fix the balance."`
  ));

  items.push(item('assess', 'operational',
    'Full assessment — identify primary patterns',
    quiz?.additionalPainAreas
      ? `Quiz flagged: ${quiz.additionalPainAreas}. Look for connections between these areas.`
      : undefined
  ));

  items.push(item('session-work', 'operational', 'Session work — address what you find'));

  items.push(item('explain', 'conversational',
    'Explain what you found and what changed — be specific',
    `"Your [X] was doing too much work. Now your [Y] is firing again." Concrete changes build trust faster than theory.`
  ));

  items.push(item('feel-check', 'conversational',
    `Ask: "How does that feel compared to when you walked in?"`,
    `Let them notice the difference. Their own words become their reason to come back.`
  ));

  items.push(item('book-next', 'operational',
    'Book next session before they leave',
    `"The first session opens things up. The next one is where we really build on that."`
  ));

  items.push(item('mention-series', 'conversational',
    'Mention the series option',
    quiz?.painDuration && quiz.painDuration.includes('year')
      ? `${firstName}'s been dealing with this for ${quiz.painDuration}. A series makes real sense here — plant the seed, don't push.`
      : `"Most people do a series — you save per session and we can really build momentum."`
  ));

  return { id: 'new-client', name: 'First Session', description: `${firstName}'s first visit`, items };
}

function buildPartner(ctx: SessionContext): ChecklistTemplate {
  const { firstName, visitCount, lastSession, daysSinceLast, nextAppt, daysUntilNext, totalDaysSpan, quiz } = ctx;
  const items: ChecklistItem[] = [];

  // Opening — reference last session specifically
  if (lastSession && daysSinceLast !== null) {
    items.push(item('checkin', 'conversational',
      `Check in on ${firstName} — last time was ${cleanTitle(lastSession.title, firstName)}, ${daysSinceLast} days ago`,
      `They're a client first. Ask how they've been feeling since. Don't open with referral talk.`
    ));
  } else {
    items.push(item('checkin', 'conversational',
      `Check in on ${firstName} — how they're feeling, what's changed`,
      `They're a client first. Don't open with referral talk — that makes it transactional.`
    ));
  }

  items.push(item('session-work', 'operational',
    'Session work — give them your best',
    'Reciprocity: the better their experience, the more naturally they refer. This IS the referral strategy.'
  ));

  // Consistency observation with real data
  if (visitCount >= 2 && totalDaysSpan && totalDaysSpan > 0) {
    const avgGap = Math.round(totalDaysSpan / (visitCount - 1));
    if (avgGap <= 10) {
      items.push(item('progress', 'conversational',
        `${visitCount} sessions in ${totalDaysSpan} days — great consistency. Tell them.`,
        `"This pace is exactly how you build lasting change. Your body is responding because you're showing up."`
      ));
    } else {
      items.push(item('progress', 'conversational',
        `Show ${firstName} their progress — be specific about what changed today`,
        `Identity reinforcement: "You're someone who takes this seriously, and your body is responding."`
      ));
    }
  } else {
    items.push(item('progress', 'conversational',
      `Show ${firstName} their progress — be specific about what changed`,
      `Identity reinforcement: "You take this seriously, and your body is responding."`
    ));
  }

  items.push(item('referral-update', 'conversational',
    `Share how their referral is doing (if you know)`,
    `"By the way, [name] is making real progress." They feel like they made a difference. If you don't know, skip it — don't fake it.`
  ));

  items.push(item('let-them-lead', 'conversational',
    `Let THEM bring up referrals — don't prompt`,
    `If they ask, answer enthusiastically. If not, that's fine. Great sessions generate referrals on their own.`
  ));

  // Scheduling gap awareness
  if (nextAppt && daysUntilNext !== null && daysUntilNext > 14 && daysSinceLast !== null && daysSinceLast < 10) {
    items.push(item('gap-flag', 'operational',
      `Next appointment is ${formatShortDate(nextAppt.startTime)} — ${daysUntilNext} days from now`,
      `That's a big gap after this rhythm. "You've been on a great pace — want to keep that momentum with something before ${formatShortDate(nextAppt.startTime)}?"`
    ));
  }

  items.push(item('end-body', 'conversational',
    `End on ${firstName}'s body, not on business`,
    lastSession
      ? `Peak-end rule: "Compared to ${cleanTitle(lastSession.title, firstName)} on ${formatShortDate(lastSession.startTime)}, your [area] is really responding." Last feeling = about them.`
      : `Peak-end rule: the last thing they feel should be about their progress, not referrals or scheduling.`
  ));

  items.push(item('book-next', 'operational',
    nextAppt
      ? `Confirm ${formatShortDate(nextAppt.startTime)} appointment`
      : 'Book next session'
  ));

  return { id: 'referral-partner', name: 'Referral Partner Session', description: `${firstName} — client first, partner second`, items };
}

function buildEarly(ctx: SessionContext): ChecklistTemplate {
  const { firstName, visitCount, lastSession, daysSinceLast, quiz, firstSession, nextAppt, lastNote } = ctx;
  const items: ChecklistItem[] = [];

  if (lastSession && daysSinceLast !== null) {
    const noteHint = lastNote
      ? `Last note: "${truncate(lastNote.body, 80)}" — reference this when checking in.`
      : `"How have you been since last time? Notice anything different with [their issue]?" Help them connect improvements to the session.`;
    items.push(item('checkin', 'conversational',
      `Check in — ${daysSinceLast} days since ${cleanTitle(lastSession.title, firstName)}`,
      noteHint
    ));
  } else {
    items.push(item('checkin', 'conversational',
      `Check in — how have they been since last session?`,
      `Help them connect any improvements to the session work.`
    ));
  }

  items.push(item('reassess', 'operational', 'Quick re-assessment'));
  items.push(item('session-work', 'operational',
    lastSession ? `Session work — build on ${cleanTitle(lastSession.title, firstName)}` : 'Session work'
  ));

  if (firstSession) {
    items.push(item('show-progress', 'conversational',
      `Show progress since first visit (${formatShortDate(firstSession.startTime)})`,
      `"When you first came in, [X]. Now [Y] is different." Concrete evidence of change reinforces commitment.`
    ));
  }

  if (ctx.seriesType === 'none') {
    items.push(item('series-hint', 'conversational',
      `${firstName} isn't in a series yet — ${visitCount + 1} visits and responding well`,
      quiz?.painDuration && quiz.painDuration.includes('year')
        ? `They've had this ${quiz.painDuration}. "You're responding really well. A series would let us keep this momentum — and with something this long-standing, that consistency matters."`
        : `"You're responding really well. A series would let us keep this momentum going."`
    ));
  }

  items.push(item('book-next', 'operational',
    nextAppt ? `Confirm ${formatShortDate(nextAppt.startTime)}` : 'Book next session'
  ));

  return { id: 'early-sessions', name: `Session ${visitCount + 1}`, description: `Building trust — show ${firstName} the progress`, items };
}

function buildOngoing(ctx: SessionContext): ChecklistTemplate {
  const { firstName, visitCount, lastSession, daysSinceLast, lastNote, nextAppt, totalDaysSpan } = ctx;
  const items: ChecklistItem[] = [];

  const checkinHint = lastNote
    ? `Last note: "${truncate(lastNote.body, 80)}" — pick up from here.`
    : '"Anything new since last time?"';
  items.push(item('checkin', 'conversational',
    lastSession && daysSinceLast !== null
      ? `Quick check-in — ${daysSinceLast} days since last session`
      : 'Quick check-in',
    checkinHint
  ));

  items.push(item('session-work', 'operational', 'Session work'));
  items.push(item('note-findings', 'operational', 'Note any new findings'));

  if (totalDaysSpan && visitCount > 1) {
    items.push(item('reinforce', 'conversational',
      `Reinforce progress — ${visitCount} sessions over ${totalDaysSpan} days`,
      `Peak-end rule: end on a high. Show them something specific that changed today.`
    ));
  }

  if (ctx.seriesType !== 'none' && ctx.sessionsRemaining <= 3 && ctx.sessionsRemaining > 1) {
    items.push(item('series-heads-up', 'conversational',
      `${ctx.sessionsRemaining} sessions left in their ${ctx.seriesType} — start planting the continuation seed`,
      `Don't wait until the last session to bring up renewal. "We're getting close to the end of your series — I want to make sure we have a plan to keep this going."`
    ));
  }

  items.push(item('book-next', 'operational',
    nextAppt ? `Confirm ${formatShortDate(nextAppt.startTime)}` : 'Confirm next appointment'
  ));

  return { id: 'ongoing', name: 'Ongoing Session', description: `${firstName} — session ${visitCount + 1}`, items };
}

function buildReturning(ctx: SessionContext): ChecklistTemplate {
  const { firstName, lastSession, daysSinceLast, quiz, lastNote } = ctx;
  const items: ChecklistItem[] = [];

  items.push(item('welcome-back', 'conversational',
    `Welcome back — it's been ${daysSinceLast} days since ${lastSession ? formatShortDate(lastSession.startTime) : 'their last visit'}`,
    `"It's great to see you. What's been going on since last time?" Let them tell you — don't guilt them about the gap.`
  ));

  items.push(item('reassess', 'operational',
    lastSession
      ? `Re-assess — check what held and what reverted since ${cleanTitle(lastSession.title, firstName)}`
      : 'Re-assess — check what held and what reverted'
  ));

  if (lastNote) {
    items.push(item('compare-notes', 'operational',
      'Compare to previous session notes',
      `Last note: "${truncate(lastNote.body, 100)}"`
    ));
  }

  items.push(item('session-work', 'operational', 'Session work — address current patterns'));

  items.push(item('explain-held', 'conversational',
    'Explain what held vs what came back',
    `"Some of what we did last time held well. [X] came back — that's normal with a gap. The body needs repetition to lock changes in."`
  ));

  items.push(item('consistency', 'conversational',
    'Discuss closer session spacing — without lecturing',
    `"The body learns through repetition. When sessions are closer together, each one builds on the last instead of starting over." Frame it as physics, not a guilt trip.`
  ));

  items.push(item('book-next', 'operational',
    'Book next session — suggest within 1-2 weeks',
    `"Let's get the next one closer so we can build on today instead of starting from scratch."`
  ));

  return { id: 'returning', name: 'Returning After Gap', description: `${firstName} is back after ${daysSinceLast} days`, items };
}

function buildEndOfPackage(ctx: SessionContext): ChecklistTemplate {
  const { firstName, visitCount, firstSession, totalDaysSpan, sessionsRemaining, seriesType } = ctx;
  const items: ChecklistItem[] = [];

  items.push(item('session-work', 'operational', 'Session work'));

  if (firstSession && totalDaysSpan) {
    items.push(item('journey-review', 'conversational',
      `Review the full journey — ${visitCount} sessions since ${formatShortDate(firstSession.startTime)}`,
      `"When you first came in, you were dealing with [X]. Look how far you've come." Let them feel the distance traveled.`
    ));
  }

  items.push(item('ask-changes', 'conversational',
    `Ask: "What changes have you noticed in daily life?"`,
    `Goal-gradient effect: they're close to the finish line. Help them see how much further they could go.`
  ));

  const isLast = sessionsRemaining <= 1;
  items.push(item('continuation', 'conversational',
    isLast
      ? `This is their last session — present continuation options`
      : `${sessionsRemaining} sessions left — start the continuation conversation`,
    seriesType === '4-session'
      ? `"You've built real momentum. The 8-session includes the Living Practice videos — a lot of people upgrade to lock in these changes." Upgrade path: 4 → 8.`
      : `"You've put in serious work. Another series would let us go deeper on [area]. Want me to tell you about options?"`
  ));

  items.push(item('hesitant', 'conversational',
    'If hesitant — acknowledge and offer a bridge',
    `Loss aversion: "I'd hate for you to lose the progress you've made. Even a few follow-ups can maintain it." Don't push — offer.`
  ));

  items.push(item('book-next', 'operational',
    'Book next session or follow-up regardless',
    `"Let's at least get one more on the calendar so you don't lose momentum." Always leave with something scheduled.`
  ));

  items.push(item('note-decision', 'operational', 'Add note about their decision'));

  return { id: 'end-of-package', name: 'End of Package', description: `${firstName}'s ${seriesType} is wrapping up`, items };
}

// ── Helpers ──

function item(id: string, category: 'operational' | 'conversational', text: string, hint?: string): ChecklistItem {
  return { id, text, category, ...(hint ? { hint } : {}) };
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatShortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function cleanTitle(title: string, firstName: string): string {
  const lower = title.toLowerCase();
  const nameLower = firstName.toLowerCase();
  // If title is just the client's name, return generic
  if (lower.includes(nameLower) && lower.replace(nameLower, '').trim().length < 5) return 'their session';
  return title
    .replace(/Amari Method /i, '')
    .replace(/ session with .*/i, '')
    .replace(/ appointment with .*/i, '');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd() + '...';
}
