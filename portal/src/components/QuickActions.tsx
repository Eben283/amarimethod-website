import { useNavigate } from 'react-router-dom';
import type { ClientData } from '../types/portal';

interface QuickActionsProps {
  client: ClientData;
  /** Opens the native Amari BookingModal (in-person / virtual toggle inside). */
  onBookSession: () => void;
  /** Kept for call-site compatibility; native BookingModal refreshes via its own success path. */
  onBooked: () => void;
}

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

  const hasHadInitial = client.sessionsCompleted > 0;
  const hasActiveSeries = client.seriesType !== 'none' && client.sessionsRemaining > 0;

  // Primary booking card — varies by state
  let primaryCard: JSX.Element;
  if (!hasHadInitial) {
    // Brand new — the public first visit is the $29, in-person Assessment.
    primaryCard = (
      <a href="/assessment-booking" className="cp-action cp-action-primary" data-testid="booking-card">
        <span className="cp-action-l">
          <span className="cp-action-h" data-testid="booking-label">Book an Amari Assessment</span>
          <span className="cp-action-p">50-minute, in-person Assessment with Garrett.</span>
        </span>
        <span className="cp-action-r">
          <span className="cp-action-price">$29</span>
          <span className="cp-action-cta">Book</span>
        </span>
      </a>
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
    // A finished practice does not expose a stale self-service follow-up price.
    primaryCard = (
      <a
        href="mailto:eben@amarimethod.com"
        className="cp-action cp-action-primary"
        data-testid="booking-card"
      >
        <span className="cp-action-l">
          <span className="cp-action-h" data-testid="booking-label">Continue your practice</span>
          <span className="cp-action-p">Talk with Garrett about the right next step.</span>
        </span>
        <span className="cp-action-r">
          <span className="cp-action-cta">Contact</span>
        </span>
      </a>
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
