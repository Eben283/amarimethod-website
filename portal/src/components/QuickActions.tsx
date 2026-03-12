import { useState } from 'react';
import { Calendar, ShoppingBag, Play, MessageCircle, TrendingUp, MapPin, Video, Gift } from 'lucide-react';
import type { ClientData } from '../types/portal';
import EmbedCalendarModal, { type EmbedCalendarType } from './EmbedCalendarModal';

interface QuickActionsProps {
  client: ClientData;
  onBookSession: () => void;
}

// Booking URLs
const BOOKING_URLS = {
  initial_inperson: 'https://amarimethodbooking.amarimethod.com/amari-method-funnel',
  initial_virtual: 'https://introsessionvirtual.amarimethod.com/is-virtual-info',
  followup: 'https://amarimethodfollowup.amarimethod.com/booking-single-amari-method-followup-session',
  discovery: 'https://discoverycall.amarimethod.com/discovery-call-booking',
};

// GHL Payment Links
const PAYMENT_LINKS = {
  series_4:        'https://link.amarimethod.com/payment-link/69986ff988a3f0163e84003d',
  series_8:        'https://link.amarimethod.com/payment-link/6998736ab409476885754915',
  upgrade_to_4:    'https://link.amarimethod.com/payment-link/699873a81a8400115e0381db',
  upgrade_to_8:    'https://link.amarimethod.com/payment-link/699873e31a840007c0038223',
  living_practice: 'https://groups.amarimethod.com/courses/offers/e339a945-b4f8-49d5-8c13-36c83a1e1afd',
  single_followup: 'https://link.amarimethod.com/payment-link/6998ad0288a3f09db4845d26',
};

const LIVING_PRACTICE_COURSE_URL = 'https://groups.amarimethod.com/';

// TODO: Once Eben creates the gift card in GHL (Payments → Gift Cards),
// paste the shareable checkout link here to activate the Buy button.
const GIFT_CARD_URL = 'https://link.amarimethod.com/gift-card/69ae353a47ad8b40dc3cdb13';

interface Action {
  icon: React.ElementType;
  label: string;
  description: string;
  href?: string;
  onClick?: () => void;
  style: 'primary' | 'secondary';
  disabled?: boolean;
}

function getSeriesActions(client: ClientData): Action[] {
  const { seriesType, sessionsCompleted, sessionsRemaining, isPartner } = client;
  const hasActiveSeries = seriesType !== 'none' && sessionsRemaining > 0;
  const seriesFinished = seriesType !== 'none' && sessionsRemaining === 0;

  // Exactly 1 pay-as-you-go session — show credit upgrade links (better deal than full price)
  // Partners are excluded: they receive a free first session, so the $225 credit does not apply
  if (seriesType === 'none' && sessionsCompleted === 1 && !isPartner) {
    return [
      {
        icon: ShoppingBag,
        label: 'Upgrade to a 4-Session Series',
        description: 'Continue your progress with 3 more sessions — your $225 is already applied',
        href: PAYMENT_LINKS.upgrade_to_4,
        style: 'secondary',
      },
      {
        icon: TrendingUp,
        label: 'Upgrade to an 8-Session Series',
        description: 'The full 8-step protocol + Living Practice — your $225 is already applied',
        href: PAYMENT_LINKS.upgrade_to_8,
        style: 'secondary',
      },
    ];
  }

  // Everyone else — 4 and 8 packs available at any time.
  // For established clients (on a series or 2+ sessions), frame around continuing their home practice.
  const isEstablished = hasActiveSeries || seriesFinished || sessionsCompleted >= 2;

  const hasHadInitialForCopy = client.sessionsCompleted > 0;

  const pack4Description = isEstablished
    ? 'Maintain and evolve your Amari at-home practice ($720)'
    : hasHadInitialForCopy
      ? 'Four sessions at a package rate ($720)'
      : 'Four follow-up sessions at a package rate ($720 — initial session purchased separately)';

  const pack8Description = isEstablished
    ? 'Deepen your at-home practice with 8 sessions + Living Practice ($1,295)'
    : hasHadInitialForCopy
      ? 'Eight sessions + Living Practice included ($1,295)'
      : 'Eight follow-up sessions + Living Practice ($1,295 — initial session purchased separately)';

  return [
    {
      icon: ShoppingBag,
      label: 'Buy a 4-Session Series',
      description: pack4Description,
      href: PAYMENT_LINKS.series_4,
      style: 'secondary',
    },
    {
      icon: TrendingUp,
      label: 'Buy an 8-Session Series',
      description: pack8Description,
      href: PAYMENT_LINKS.series_8,
      style: 'secondary',
    },
  ];
}

export default function QuickActions({ client, onBookSession: _onBookSession }: QuickActionsProps) {
  const [showInitialChoice, setShowInitialChoice] = useState(false);
  const [showSeriesChoice, setShowSeriesChoice] = useState(false);
  const [showFollowupChoice, setShowFollowupChoice] = useState(false);
  const [embedCalendarType, setEmbedCalendarType] = useState<EmbedCalendarType | null>(null);

  const hasHadInitial = client.sessionsCompleted > 0;
  const bookingLabel = hasHadInitial ? 'Book Follow-up Session' : 'Book Initial Session';

  // Active series = on a series with sessions remaining (pre-paid, modal booking)
  // Pay-as-you-go = has had sessions but no pre-paid sessions left (pay per session)
  //   Includes: no-series clients who've had sessions, AND finished-series clients
  const hasActiveSeries = client.seriesType !== 'none' && client.sessionsRemaining > 0;
  const isPayAsYouGo = hasHadInitial && !hasActiveSeries;
  const bookingAction: Action = !hasHadInitial
    ? {
        icon: Calendar,
        label: bookingLabel,
        description: 'Start your journey with a 60-min session',
        onClick: () => setShowInitialChoice(true),
        style: 'primary',
      }
    : hasActiveSeries
    ? {
        icon: Calendar,
        label: bookingLabel,
        description: 'Schedule your next in-person or virtual session',
        onClick: () => setShowSeriesChoice(true),
        style: 'primary',
      }
    : {
        // Pay-as-you-go or finished series — choose in-person or virtual, then book + pay
        icon: Calendar,
        label: bookingLabel,
        description: 'Book and pay for a single session ($190)',
        onClick: () => setShowFollowupChoice(true),
        style: 'primary',
      };

  const livingPracticeAction: Action = client.hasLivingPractice
    ? {
        icon: Play,
        label: 'Living Practice',
        description: 'Continue your video program →',
        href: LIVING_PRACTICE_COURSE_URL,
        style: 'secondary',
      }
    : {
        icon: Play,
        label: 'Living Practice',
        description: 'Add the standalone video program ($347)',
        href: PAYMENT_LINKS.living_practice,
        style: 'secondary',
      };

  const contactAction: Action = {
    icon: MessageCircle,
    label: 'Contact Dr. Garrett',
    description: 'Questions about your care?',
    href: 'mailto:hello@amarimethod.com',
    style: 'secondary',
  };

  const partnerAction: Action | null = client.isPartner
    ? {
        icon: Gift,
        label: 'Referral Toolkit',
        description: 'Refer clients & track your referrals →',
        href: 'https://www.amarimethod.com/partner-app',
        style: 'secondary',
      }
    : null;

  const giftCardAction: Action | null = GIFT_CARD_URL
    ? {
        icon: Gift,
        label: 'Buy a Gift Card',
        description: 'Give the session that changes everything',
        href: GIFT_CARD_URL,
        style: 'secondary',
      }
    : null;

  const seriesActions = getSeriesActions(client);

  const actions: Action[] = [
    bookingAction,
    ...seriesActions,
    livingPracticeAction,
    ...(partnerAction ? [partnerAction] : []),
    ...(giftCardAction ? [giftCardAction] : []),
    contactAction,
  ];

  return (
    <>
      <div className="space-y-4">
        {/* Primary booking action — full width */}
        {(() => {
          const action = actions[0];
          const Icon = action.icon;
          const isBookingCard = action.label === bookingLabel && !hasHadInitial;
          const isSeriesCard = action.label === bookingLabel && hasActiveSeries;
          const isPayAsYouGoCard = action.label === bookingLabel && isPayAsYouGo;

          if (isSeriesCard) {
            return (
              <div key={action.label} className="portal-card border-amari-charcoal">
                {!showSeriesChoice ? (
                  <button
                    onClick={() => setShowSeriesChoice(true)}
                    className="flex items-start gap-4 w-full text-left"
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-charcoal text-white">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-sans font-semibold text-amari-charcoal text-sm">{action.label}</h3>
                      <p className="text-xs text-amari-text-muted mt-0.5">{action.description}</p>
                    </div>
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-charcoal text-white">
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 className="font-sans font-semibold text-amari-charcoal text-sm">How would you like to meet?</h3>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEmbedCalendarType('prepaid_inperson')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-amari-charcoal text-white rounded-lg text-xs font-semibold hover:bg-opacity-90 transition-colors"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        In Person
                      </button>
                      <button
                        onClick={() => setEmbedCalendarType('prepaid_virtual')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 border border-amari-charcoal text-amari-charcoal rounded-lg text-xs font-semibold hover:bg-amari-light-sand transition-colors"
                      >
                        <Video className="w-3.5 h-3.5" />
                        Virtual
                      </button>
                    </div>
                    <button
                      onClick={() => setShowSeriesChoice(false)}
                      className="mt-2 text-xs text-amari-text-muted hover:text-amari-charcoal transition-colors"
                    >
                      ← Back
                    </button>
                  </div>
                )}
              </div>
            );
          }

          if (isPayAsYouGoCard) {
            return (
              <div key={action.label} className="portal-card border-amari-charcoal">
                {!showFollowupChoice ? (
                  <button
                    onClick={() => setShowFollowupChoice(true)}
                    className="flex items-start gap-4 w-full text-left"
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-charcoal text-white">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-sans font-semibold text-amari-charcoal text-sm">{action.label}</h3>
                      <p className="text-xs text-amari-text-muted mt-0.5">{action.description}</p>
                    </div>
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-charcoal text-white">
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 className="font-sans font-semibold text-amari-charcoal text-sm">How would you like to meet?</h3>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEmbedCalendarType('followup_inperson')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-amari-charcoal text-white rounded-lg text-xs font-semibold hover:bg-opacity-90 transition-colors"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        In Person
                      </button>
                      <button
                        onClick={() => setEmbedCalendarType('followup_virtual')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 border border-amari-charcoal text-amari-charcoal rounded-lg text-xs font-semibold hover:bg-amari-light-sand transition-colors"
                      >
                        <Video className="w-3.5 h-3.5" />
                        Virtual
                      </button>
                    </div>
                    <button
                      onClick={() => setShowFollowupChoice(false)}
                      className="mt-2 text-xs text-amari-text-muted hover:text-amari-charcoal transition-colors"
                    >
                      ← Back
                    </button>
                  </div>
                )}
              </div>
            );
          }

          if (isBookingCard) {
            return (
              <div key={action.label} className="portal-card border-amari-charcoal">
                {!showInitialChoice ? (
                  <button
                    onClick={() => setShowInitialChoice(true)}
                    className="flex items-start gap-4 w-full text-left"
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-charcoal text-white">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-sans font-semibold text-amari-charcoal text-sm">{action.label}</h3>
                      <p className="text-xs text-amari-text-muted mt-0.5">{action.description}</p>
                    </div>
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-charcoal text-white">
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 className="font-sans font-semibold text-amari-charcoal text-sm">How would you like to meet?</h3>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={BOOKING_URLS.initial_inperson}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-amari-charcoal text-white rounded-lg text-xs font-semibold hover:bg-opacity-90 transition-colors no-underline"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        In Person
                      </a>
                      <a
                        href={BOOKING_URLS.initial_virtual}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 border border-amari-charcoal text-amari-charcoal rounded-lg text-xs font-semibold hover:bg-amari-light-sand transition-colors no-underline"
                      >
                        <Video className="w-3.5 h-3.5" />
                        Virtual
                      </a>
                    </div>
                    <button
                      onClick={() => setShowInitialChoice(false)}
                      className="mt-2 text-xs text-amari-text-muted hover:text-amari-charcoal transition-colors"
                    >
                      ← Back
                    </button>
                  </div>
                )}
              </div>
            );
          }

          // Fallback for primary action that doesn't match special cards
          const content = (
            <div className="portal-card flex items-start gap-4 border-amari-charcoal cursor-pointer hover:shadow-card-hover">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-charcoal text-white">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-sans font-semibold text-amari-charcoal text-sm">{action.label}</h3>
                <p className="text-xs text-amari-text-muted mt-0.5">{action.description}</p>
              </div>
            </div>
          );
          if (action.onClick) {
            return <button key={action.label} onClick={action.onClick} className="text-left no-underline w-full">{content}</button>;
          }
          if (action.href) {
            return <a key={action.label} href={action.href} target="_blank" rel="noopener noreferrer" className="no-underline">{content}</a>;
          }
          return <div key={action.label}>{content}</div>;
        })()}

        {/* Secondary actions — 2-column grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {actions.slice(1).map((action) => {
          const Icon = action.icon;
          const isDisabled = !!action.disabled;

          const content = (
            <div
              className={`portal-card flex items-start gap-4 ${
                isDisabled ? 'opacity-50 cursor-default' : 'cursor-pointer hover:shadow-card-hover'
              }`}
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-amari-light-sand text-amari-charcoal">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-sans font-semibold text-amari-charcoal text-sm">
                  {action.label}
                </h3>
                <p className="text-xs text-amari-text-muted mt-0.5">
                  {action.description}
                </p>
              </div>
            </div>
          );

          if (action.onClick) {
            return (
              <button key={action.label} onClick={action.onClick} className="text-left no-underline w-full">
                {content}
              </button>
            );
          }

          if (isDisabled || !action.href) {
            return <div key={action.label}>{content}</div>;
          }

          return (
            <a
              key={action.label}
              href={action.href}
              target={action.href.startsWith('http') ? '_blank' : undefined}
              rel={action.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="no-underline"
            >
              {content}
            </a>
          );
        })}
        </div>
      </div>

      {embedCalendarType && (
        <EmbedCalendarModal
          calendarType={embedCalendarType}
          onClose={() => {
            setEmbedCalendarType(null);
            setShowSeriesChoice(false);
            setShowFollowupChoice(false);
          }}
        />
      )}
    </>
  );
}
