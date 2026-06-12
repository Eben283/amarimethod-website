import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClientData } from '../types/portal';
import EmbedCalendarModal, { type EmbedCalendarType } from './EmbedCalendarModal';

interface QuickActionsProps {
  client: ClientData;
  onBookSession: () => void;
  /** Refresh dashboard data after the embedded calendar modal closes — the
   *  iframe gives us no booking event, so we refetch on close to reflect any
   *  session the user just booked. */
  onBooked: () => void;
}

// Booking URLs. Initial sessions point to the native flow at /book/<variant>;
// follow-up + discovery still 301 to GHL (phase 2/3).
const BOOKING_URLS = {
  initial_inperson: '/book/initial-in-person',
  initial_virtual: '/book/initial-virtual',
};

// GHL Payment Links
const PAYMENT_LINKS = {
  series_4:        'https://link.amarimethod.com/payment-link/69986ff988a3f0163e84003d',
  series_8:        'https://link.amarimethod.com/payment-link/6998736ab409476885754915',
  upgrade_to_4:    'https://link.amarimethod.com/payment-link/699873a81a8400115e0381db',
  upgrade_to_8:    'https://link.amarimethod.com/payment-link/699873e31a840007c0038223',
  living_practice: 'https://groups.amarimethod.com/courses/offers/e339a945-b4f8-49d5-8c13-36c83a1e1afd',
};
const GIFT_CARD_URL = 'https://link.amarimethod.com/gift-card/69ae353a47ad8b40dc3cdb13';
const LIVING_PRACTICE_ROUTE = '/practice';
const TOOLS_URL = 'https://www.amarimethod.com/tools';

interface Action {
  label: string;
  description: string;
  price?: string;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
  muted?: boolean;
  testId?: string;
  external?: boolean; // open in new tab
}

function getSeriesActions(client: ClientData): Action[] {
  const { seriesType, sessionsCompleted, sessionsRemaining, isPartner } = client;
  const hasActiveSeries = seriesType !== 'none' && sessionsRemaining > 0;
  const seriesFinished = seriesType !== 'none' && sessionsRemaining === 0;

  // Exactly 1 pay-as-you-go session — credit upgrade beats buying full price
  if (seriesType === 'none' && sessionsCompleted === 1 && !isPartner) {
    return [
      {
        label: 'Upgrade to a 4-session series',
        description: 'Continue with 3 more sessions — your $225 is already applied.',
        price: '$495',
        href: PAYMENT_LINKS.upgrade_to_4,
        
        testId: 'upgrade-to-4-card',
      },
      {
        label: 'Upgrade to an 8-session series',
        description: 'Full 8-step protocol + Living Practice — your $225 is already applied.',
        price: '$1,070',
        href: PAYMENT_LINKS.upgrade_to_8,
        
        testId: 'upgrade-to-8-card',
      },
    ];
  }

  const isEstablished = hasActiveSeries || seriesFinished || sessionsCompleted >= 2;
  const hasHadInitialForCopy = client.sessionsCompleted > 0;

  const pack4Description = isEstablished
    ? 'Maintain and evolve your at-home practice.'
    : hasHadInitialForCopy
      ? 'Four sessions at a package rate.'
      : 'Four follow-up sessions at a package rate (initial purchased separately).';

  const pack8Description = isEstablished
    ? 'Deepen your at-home practice with 8 sessions + Living Practice.'
    : hasHadInitialForCopy
      ? 'Eight sessions + Living Practice included.'
      : 'Eight follow-up sessions + Living Practice (initial purchased separately).';

  return [
    {
      label: '4-session series',
      description: pack4Description,
      price: '$720',
      href: PAYMENT_LINKS.series_4,
      
      testId: 'series-4-card',
    },
    {
      label: '8-session series',
      description: pack8Description,
      price: '$1,295',
      href: PAYMENT_LINKS.series_8,
      
      testId: 'series-8-card',
    },
  ];
}

function ActionCard({ a }: { a: Action }) {
  const className = 'cp-action'
    + (a.primary ? ' cp-action-primary' : '')
    + (a.muted ? ' is-muted' : '');
  const inner = (
    <>
      <span className="cp-action-l">
        <span className="cp-action-h">{a.label}</span>
        <span className="cp-action-p">{a.description}</span>
      </span>
      <span className="cp-action-r">
        {a.price && <span className="cp-action-price">{a.price}</span>}
        <span className="cp-arrow">→</span>
      </span>
    </>
  );
  if (a.href) {
    return (
      <a
        href={a.href}
        target={a.external ? '_blank' : undefined}
        rel={a.external ? 'noopener noreferrer' : undefined}
        className={className}
        data-testid={a.testId}
      >
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={a.onClick} data-testid={a.testId}>
      {inner}
    </button>
  );
}

export default function QuickActions({ client, onBookSession: _onBookSession, onBooked }: QuickActionsProps) {
  const navigate = useNavigate();
  const [showInitialChoice, setShowInitialChoice] = useState(false);
  const [showSeriesChoice, setShowSeriesChoice] = useState(false);
  const [showFollowupChoice, setShowFollowupChoice] = useState(false);
  const [embedCalendarType, setEmbedCalendarType] = useState<EmbedCalendarType | null>(null);

  const hasHadInitial = client.sessionsCompleted > 0;
  const hasActiveSeries = client.seriesType !== 'none' && client.sessionsRemaining > 0;
  const isPayAsYouGo = hasHadInitial && !hasActiveSeries;

  // Primary booking card — varies by state
  let primaryCard: JSX.Element;
  if (!hasHadInitial) {
    // Brand new — pick in-person or virtual for the initial
    primaryCard = (
      <BookingCard
        label="Book your initial session"
        description="60-minute assessment with Dr. Garrett."
        price="$225"
        open={showInitialChoice}
        onOpen={() => setShowInitialChoice(true)}
        onClose={() => setShowInitialChoice(false)}
        choices={[
          { label: 'In person', href: BOOKING_URLS.initial_inperson,  },
          { label: 'Virtual', href: BOOKING_URLS.initial_virtual,  ghost: true },
        ]}
      />
    );
  } else if (hasActiveSeries) {
    // Series member — book from pre-paid pool, pick in-person or virtual
    primaryCard = (
      <BookingCard
        label="Book your next session"
        description={`${client.sessionsRemaining} session${client.sessionsRemaining === 1 ? '' : 's'} left in your series.`}
        price="Included"
        open={showSeriesChoice}
        onOpen={() => setShowSeriesChoice(true)}
        onClose={() => setShowSeriesChoice(false)}
        choices={[
          { label: 'In person', onClick: () => setEmbedCalendarType('prepaid_inperson') },
          { label: 'Virtual', onClick: () => setEmbedCalendarType('prepaid_virtual'), ghost: true },
        ]}
      />
    );
  } else {
    // Pay-as-you-go or finished series — book + pay per session
    primaryCard = (
      <BookingCard
        label="Book a follow-up session"
        description="Book and pay for a single session."
        price="$190"
        open={showFollowupChoice}
        onOpen={() => setShowFollowupChoice(true)}
        onClose={() => setShowFollowupChoice(false)}
        choices={[
          { label: 'In person', onClick: () => setEmbedCalendarType('followup_inperson') },
          { label: 'Virtual', onClick: () => setEmbedCalendarType('followup_virtual'), ghost: true },
        ]}
      />
    );
  }

  const seriesActions = getSeriesActions(client);

  const livingPracticeAction: Action = client.hasLivingPractice
    ? {
        label: 'Continue Living Practice',
        description: 'Your daily home-practice videos with Dr. Garrett.',
        onClick: () => navigate(LIVING_PRACTICE_ROUTE),
        testId: 'living-practice-card',
      }
    : {
        label: 'Living Practice',
        description: 'Standalone video program for daily home practice.',
        price: '$347',
        href: PAYMENT_LINKS.living_practice,
        external: true, // its own app — keep portal open behind it
        testId: 'living-practice-card',
      };

  const toolsAction: Action = {
    label: 'Tools for the protocols',
    description: 'Equipment we recommend for your practice at home.',
    href: TOOLS_URL,
    
  };

  const giftCardAction: Action | null = GIFT_CARD_URL
    ? {
        label: 'Buy a gift card',
        description: 'Give the session that changes everything.',
        href: GIFT_CARD_URL,
        
      }
    : null;

  const partnerAction: Action | null = client.isPartner
    ? {
        label: 'Referral toolkit',
        description: 'Refer clients & track your referrals.',
        href: 'https://www.amarimethod.com/partner-app',
        
        testId: 'partner-toolkit-card',
      }
    : null;

  const contactAction: Action = {
    label: 'Contact Dr. Garrett',
    description: 'Questions, scheduling, or notes between sessions.',
    href: 'mailto:eben@amarimethod.com',
    muted: true,
  };

  const secondaryActions: Action[] = [
    ...seriesActions,
    livingPracticeAction,
    toolsAction,
    ...(giftCardAction ? [giftCardAction] : []),
    ...(partnerAction ? [partnerAction] : []),
    contactAction,
  ];

  return (
    <>
      <section className="cp-actions">
        <div className="cp-section-head">
          <h3 className="cp-section-h">Book &amp; manage</h3>
        </div>
        <div className="cp-actions-grid">
          {primaryCard}
          {secondaryActions.map((a) => <ActionCard key={a.label} a={a} />)}
        </div>
      </section>

      {embedCalendarType && (
        <EmbedCalendarModal
          calendarType={embedCalendarType}
          onClose={() => {
            setEmbedCalendarType(null);
            setShowSeriesChoice(false);
            setShowFollowupChoice(false);
            // Reflect any session booked inside the embed (no booking event
            // crosses the iframe boundary, so refetch on close).
            onBooked();
          }}
        />
      )}
    </>
  );
}

/* --- inline "choose in-person or virtual" expanding card --- */
interface Choice {
  label: string;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  ghost?: boolean;
}
function BookingCard({
  label, description, price, open, onOpen, onClose, choices,
}: {
  label: string;
  description: string;
  price?: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  choices: Choice[];
}) {
  if (!open) {
    return (
      <button
        type="button"
        className="cp-action cp-action-primary"
        onClick={onOpen}
        data-testid="booking-card"
      >
        <span className="cp-action-l">
          <span className="cp-action-h" data-testid="booking-label">{label}</span>
          <span className="cp-action-p">{description}</span>
        </span>
        <span className="cp-action-r">
          {price && <span className="cp-action-price">{price}</span>}
          <span className="cp-arrow">→</span>
        </span>
      </button>
    );
  }
  return (
    <div
      className="cp-action cp-action-primary"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 14, gridColumn: '1 / -1' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="cp-action-h">How would you like to meet?</span>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'transparent', border: 0, color: '#C9BEA9', fontSize: 13, cursor: 'pointer', padding: 4 }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {choices.map((c) => {
          const cls = c.ghost
            ? 'cp-btn cp-btn-ghost'
            : 'cp-btn cp-btn-primary';
          const style: React.CSSProperties = c.ghost
            ? { background: 'rgba(247,242,232,0.06)', color: 'var(--cp-paper)', borderColor: 'rgba(245,221,210,0.32)' }
            : { background: 'var(--cp-paper)', color: 'var(--cp-ink)' };
          if (c.href) {
            return (
              <a
                key={c.label}
                href={c.href}
                
                
                className={cls}
                style={style}
              >
                {c.label}
              </a>
            );
          }
          return (
            <button key={c.label} type="button" onClick={c.onClick} className={cls} style={style}>
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
