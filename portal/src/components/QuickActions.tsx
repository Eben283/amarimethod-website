import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ClientData } from '../types/portal';

interface QuickActionsProps {
  client: ClientData;
  /** Opens the native Amari BookingModal (in-person / virtual toggle inside). */
  onBookSession: () => void;
  /** Kept for call-site compatibility; native BookingModal refreshes via its own success path. */
  onBooked: () => void;
}

// Initial sessions use the public native bookers. Follow-ups use BookingModal
// (shared Amari calendar) — see SYSTEM.md. Do not reintroduce GHL embeds.
const BOOKING_URLS = {
  initial_inperson: '/book/initial-in-person',
  initial_virtual: '/book/initial-virtual',
};

const PAYMENT_LINKS = {
  living_practice: 'https://groups.amarimethod.com/courses/offers/e339a945-b4f8-49d5-8c13-36c83a1e1afd',
};
const GIFT_CARD_URL = 'https://link.amarimethod.com/gift-card/69ae353a47ad8b40dc3cdb13';
const LIVING_PRACTICE_ROUTE = '/practice';
const TOOLS_URL = 'https://www.amarimethod.com/tools';

interface Action {
  label: string;
  description: string;
  price?: string;
  /** Uppercase button label — site-v6 BOOK NOW pattern */
  cta?: string;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
  muted?: boolean;
  testId?: string;
  external?: boolean; // open in new tab
}

function ActionCard({ a }: { a: Action }) {
  const className = 'cp-action'
    + (a.primary ? ' cp-action-primary' : '')
    + (a.muted ? ' is-muted' : '');
  const cta = a.cta || 'Open';
  const inner = (
    <>
      <span className="cp-action-l">
        <span className="cp-action-h">{a.label}</span>
        <span className="cp-action-p">{a.description}</span>
      </span>
      <span className="cp-action-r">
        {a.price && <span className="cp-action-price">{a.price}</span>}
        <span className="cp-action-cta">{cta}</span>
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

export default function QuickActions({ client, onBookSession, onBooked: _onBooked }: QuickActionsProps) {
  const navigate = useNavigate();
  const [showInitialChoice, setShowInitialChoice] = useState(false);

  const hasHadInitial = client.sessionsCompleted > 0;
  const hasActiveSeries = client.seriesType !== 'none' && client.sessionsRemaining > 0;

  // Primary booking card — varies by state
  let primaryCard: JSX.Element;
  if (!hasHadInitial) {
    // Brand new — pick in-person or virtual for the initial (public native bookers)
    primaryCard = (
      <BookingCard
        label="Book your initial session"
        description="60-minute assessment with Garrett."
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
    // Series member — native Amari BookingModal (in-person / virtual inside)
    primaryCard = (
      <button
        type="button"
        className="cp-action cp-action-primary"
        onClick={onBookSession}
        data-testid="booking-card"
      >
        <span className="cp-action-l">
          <span className="cp-action-h" data-testid="booking-label">Book your next session</span>
          <span className="cp-action-p">
            {`${client.sessionsRemaining} session${client.sessionsRemaining === 1 ? '' : 's'} left in your series.`}
          </span>
        </span>
        <span className="cp-action-r">
          <span className="cp-action-price">Included</span>
          <span className="cp-action-cta">Book</span>
        </span>
      </button>
    );
  } else {
    // Pay-as-you-go or finished series — same native modal. portal-book requires
    // prepaid balance; with none left the modal surfaces that and series cards below.
    primaryCard = (
      <button
        type="button"
        className="cp-action cp-action-primary"
        onClick={onBookSession}
        data-testid="booking-card"
      >
        <span className="cp-action-l">
          <span className="cp-action-h" data-testid="booking-label">Book a follow-up session</span>
          <span className="cp-action-p">Pick a time, then pay $190 for a single session.</span>
        </span>
        <span className="cp-action-r">
          <span className="cp-action-price">$190</span>
          <span className="cp-action-cta">Book</span>
        </span>
      </button>
    );
  }

  const livingPracticeAction: Action = client.hasLivingPractice
    ? {
        label: 'Continue Living Practice',
        description: 'Your daily home-practice videos with Garrett.',
        cta: 'Open',
        onClick: () => navigate(LIVING_PRACTICE_ROUTE),
        testId: 'living-practice-card',
      }
    : {
        label: 'Living Practice',
        description: 'Standalone video program for daily home practice.',
        price: '$347',
        cta: 'Buy',
        href: PAYMENT_LINKS.living_practice,
        external: true, // its own app — keep portal open behind it
        testId: 'living-practice-card',
      };

  const toolsAction: Action = {
    label: 'Tools for the protocols',
    description: 'Equipment we recommend for your practice at home.',
    cta: 'Shop',
    href: TOOLS_URL,
  };

  const giftCardAction: Action | null = GIFT_CARD_URL
    ? {
        label: 'Buy a gift card',
        description: 'Give the session that changes everything.',
        cta: 'Buy',
        href: GIFT_CARD_URL,
      }
    : null;

  const partnerAction: Action | null = client.isPartner
    ? {
        label: 'Referral toolkit',
        description: 'Refer practice members & track your referrals.',
        cta: 'Open',
        href: 'https://www.amarimethod.com/partner-app',
        testId: 'partner-toolkit-card',
      }
    : null;

  const contactAction: Action = {
    label: 'Contact Garrett',
    description: 'Questions, scheduling, or notes between sessions.',
    cta: 'Email',
    href: 'mailto:eben@amarimethod.com',
    muted: true,
  };

  const secondaryActions: Action[] = [
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
          <span className="cp-action-cta">Book</span>
        </span>
      </button>
    );
  }
  return (
    <div
      className="cp-action cp-action-primary is-open"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 14, gridColumn: '1 / -1' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="cp-action-h">How would you like to meet?</span>
        <button
          type="button"
          onClick={onClose}
          className="cp-action-close"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {choices.map((c) => {
          const cls = c.ghost
            ? 'cp-btn cp-btn-ghost cp-btn-on-ink'
            : 'cp-btn cp-btn-pale';
          if (c.href) {
            return (
              <a
                key={c.label}
                href={c.href}
                className={cls}
              >
                {c.label}
              </a>
            );
          }
          return (
            <button key={c.label} type="button" onClick={c.onClick} className={cls}>
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
