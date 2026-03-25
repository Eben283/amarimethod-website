import type { ChecklistTemplate } from '../types/staff';

interface ClientContext {
  sessionsCompleted: number;
  sessionsRemaining: number;
  tags: string[];
  lastAppointment: string | null;
}

const TWENTY_ONE_DAYS_MS = 21 * 24 * 60 * 60 * 1000;

const templates: ChecklistTemplate[] = [
  {
    id: 'new-client',
    name: 'New Client Session',
    description: 'First session — set the foundation',
    items: [
      { id: 'nc-1', text: 'Confirm they completed the pain assessment quiz', category: 'operational' },
      { id: 'nc-2', text: 'Review quiz results together', category: 'operational' },
      { id: 'nc-3', text: 'Introduce the Amari Method — active vs passive system', category: 'operational', hint: '"Your body has muscles working too hard because others aren\'t working enough. We find those and fix the balance."' },
      { id: 'nc-4', text: 'Full assessment — identify primary patterns', category: 'operational' },
      { id: 'nc-5', text: 'Session work — address what you find', category: 'operational' },
      { id: 'nc-6', text: 'Explain what you found and what changed', category: 'conversational', hint: 'Be specific: "Your left hip flexor was doing too much work. Now your glute is firing again."' },
      { id: 'nc-7', text: 'Ask: "How does that feel compared to when you walked in?"', category: 'conversational', hint: 'Let them notice the difference — they\'ll sell themselves on the method.' },
      { id: 'nc-8', text: 'Book next session before they leave', category: 'operational', hint: '"The first session opens things up. The next one is where we really build on that."' },
      { id: 'nc-9', text: 'Mention the 4-session or 8-session series', category: 'conversational', hint: '"Most people do a series — you save per session and we can really build momentum. Want me to tell you about it?"' },
    ],
  },
  {
    id: 'referral-partner',
    name: 'Referral Partner Session',
    description: 'They\'re a client first, partner second — earn the referrals through the experience',
    items: [
      { id: 'rp-1', text: 'Check in on THEM first — how they\'re feeling, what\'s changed', category: 'conversational', hint: 'They\'re a client first. Don\'t open with referral talk — that makes it transactional.' },
      { id: 'rp-2', text: 'Session work — give them your best', category: 'operational', hint: 'Reciprocity: the better their experience, the more naturally they refer. This IS the referral strategy.' },
      { id: 'rp-3', text: 'Show them their progress — be specific about what changed', category: 'conversational', hint: 'Identity reinforcement: "You\'re someone who takes this seriously, and your body is responding."' },
      { id: 'rp-4', text: 'Share how their referral is doing (if appropriate)', category: 'conversational', hint: 'Social proof: "By the way, [name] is making real progress — that hip issue is resolving." They feel like they made a difference, not a transaction.' },
      { id: 'rp-5', text: 'Let THEM bring up referrals — don\'t prompt', category: 'conversational', hint: 'If they ask about the program, answer enthusiastically. If they don\'t, that\'s fine — great sessions generate referrals on their own.' },
      { id: 'rp-6', text: 'End on their body, not on business', category: 'conversational', hint: 'Peak-end rule: the last thing they feel should be about their progress. "Your [area] is really responding — I\'m excited for where this is heading."' },
      { id: 'rp-7', text: 'Book next session', category: 'operational' },
    ],
  },
  {
    id: 'end-of-package',
    name: 'End of Package',
    description: 'Last session(s) — renew the relationship',
    items: [
      { id: 'ep-1', text: 'Session work', category: 'operational' },
      { id: 'ep-2', text: 'Review total progress since they started the series', category: 'conversational', hint: '"When you first came in, you were dealing with [X]. Look how far you\'ve come."' },
      { id: 'ep-3', text: 'Ask: "What changes have you noticed in daily life?"', category: 'conversational', hint: 'Goal-gradient effect: they\'re close to the finish, but show them how much further they could go.' },
      { id: 'ep-4', text: 'Present continuation options', category: 'conversational', hint: '"You\'ve built real momentum. A lot of people continue with another series to lock in these changes. The 8-session includes the Living Practice videos too."' },
      { id: 'ep-5', text: 'If hesitant: acknowledge and offer follow-up', category: 'conversational', hint: 'Loss aversion: "I\'d hate for you to lose the progress you\'ve made. Even a few follow-ups can maintain it."' },
      { id: 'ep-6', text: 'Book next session or follow-up regardless', category: 'operational', hint: '"Let\'s at least get one more on the calendar so you don\'t lose momentum."' },
      { id: 'ep-7', text: 'Add note about their decision', category: 'operational' },
    ],
  },
  {
    id: 'returning-after-gap',
    name: 'Returning After Gap',
    description: 'Client returning after 3+ weeks — re-assess',
    items: [
      { id: 'rg-1', text: 'Welcome back — ask what brought them in again', category: 'conversational', hint: '"It\'s great to see you. What\'s been going on since last time?"' },
      { id: 'rg-2', text: 'Re-assess — check what held and what reverted', category: 'operational' },
      { id: 'rg-3', text: 'Compare to previous session notes', category: 'operational' },
      { id: 'rg-4', text: 'Session work — address current patterns', category: 'operational' },
      { id: 'rg-5', text: 'Explain what changed and what stayed', category: 'conversational', hint: '"Some of what we did last time held well. [X] came back though — that\'s normal with a gap."' },
      { id: 'rg-6', text: 'Discuss consistency for lasting results', category: 'conversational', hint: 'Commitment consistency: "The body learns through repetition. Closer sessions = faster, more lasting change."' },
      { id: 'rg-7', text: 'Book next session — suggest closer spacing', category: 'operational' },
    ],
  },
  {
    id: 'early-sessions',
    name: 'Early Sessions (2-3)',
    description: 'Building trust and showing progress',
    items: [
      { id: 'es-1', text: 'Check in: "How have you been since last session?"', category: 'conversational' },
      { id: 'es-2', text: 'Ask about any changes they noticed between sessions', category: 'conversational', hint: 'They may not connect improvements to the session. Help them see: "Did you notice anything different with [X]?"' },
      { id: 'es-3', text: 'Quick re-assessment', category: 'operational' },
      { id: 'es-4', text: 'Session work — build on previous session', category: 'operational' },
      { id: 'es-5', text: 'Show progress: "Last time [X] was tight, now [Y] is different"', category: 'conversational', hint: 'Concrete evidence of change reinforces their commitment.' },
      { id: 'es-6', text: 'If not in a series yet: mention the option', category: 'conversational', hint: '"You\'re responding really well. A series would let us keep this momentum going."' },
      { id: 'es-7', text: 'Book next session', category: 'operational' },
    ],
  },
  {
    id: 'ongoing',
    name: 'Ongoing Session',
    description: 'Regular client (4+ sessions) — maintain and deepen',
    items: [
      { id: 'og-1', text: 'Quick check-in: "Anything new since last time?"', category: 'conversational' },
      { id: 'og-2', text: 'Session work', category: 'operational' },
      { id: 'og-3', text: 'Note any new findings', category: 'operational' },
      { id: 'og-4', text: 'Reinforce their progress', category: 'conversational', hint: 'Peak-end rule: make sure the session ends on a high note — show them something that changed.' },
      { id: 'og-5', text: 'Confirm next appointment', category: 'operational' },
    ],
  },
];

export function selectChecklist(context: ClientContext): ChecklistTemplate | null {
  // Priority order — first match wins
  // Referral partners always get the partner checklist, regardless of session count
  if (context.tags.includes('affiliate-partner')) {
    return templates.find(t => t.id === 'referral-partner') ?? null;
  }

  if (context.sessionsCompleted === 0) {
    return templates.find(t => t.id === 'new-client') ?? null;
  }

  if (context.sessionsRemaining <= 1 && context.sessionsRemaining >= 0) {
    return templates.find(t => t.id === 'end-of-package') ?? null;
  }

  if (context.lastAppointment) {
    const gap = Date.now() - new Date(context.lastAppointment).getTime();
    if (gap > TWENTY_ONE_DAYS_MS) {
      return templates.find(t => t.id === 'returning-after-gap') ?? null;
    }
  }

  if (context.sessionsCompleted >= 1 && context.sessionsCompleted <= 3) {
    return templates.find(t => t.id === 'early-sessions') ?? null;
  }

  if (context.sessionsCompleted >= 4) {
    return templates.find(t => t.id === 'ongoing') ?? null;
  }

  return templates.find(t => t.id === 'ongoing') ?? null;
}

export { templates };
