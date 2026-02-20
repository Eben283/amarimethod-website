import { useState } from 'react';
import { Calendar, ShoppingBag, Play, MessageCircle, TrendingUp, MapPin, Video } from 'lucide-react';
import type { ClientData } from '../types/portal';

interface QuickActionsProps {
  client: ClientData;
  onBookSession: () => void;
}

// Booking URLs
const BOOKING_URLS = {
  initial_inperson: 'https://back-pain-session-inperson.amarimethod.com/client-info',
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
  upgrade_4_to_8:  'https://link.amarimethod.com/payment-link/699874221a8400d21b038273',
  living_practice: 'https://link.amarimethod.com/payment-link/6998745744f21f09ead95e82',
};

const LIVING_PRACTICE_COURSE_URL = 'https://groups.amarimethod.com/courses/offers/e339a945-b4f8-49d5-8c13-36c83a1e1afd';

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
  const { seriesType, sessionsCompleted } = client;

  // Already on 8-session series — top tier, nothing to upgrade to
  if (seriesType === '8-session') {
    return [];
  }

  // Already on 4-session series — offer upgrade to 8
  if (seriesType === '4-session') {
    return [
      {
        icon: TrendingUp,
        label: 'Upgrade to 8-Session Series',
        description: 'Add 4 more sessions + Living Practice — pay just $475',
        href: PAYMENT_LINKS.upgrade_4_to_8,
        style: 'secondary',
      },
    ];
  }

  // Had initial session, no series yet — show apply-the-difference pricing
  if (sessionsCompleted >= 1) {
    return [
      {
        icon: ShoppingBag,
        label: 'Continue with a 4-Session Series',
        description: 'Your initial session applies — pay just $545',
        href: PAYMENT_LINKS.upgrade_to_4,
        style: 'secondary',
      },
      {
        icon: TrendingUp,
        label: 'Continue with an 8-Session Series',
        description: 'Your initial session applies — pay just $1,020',
        href: PAYMENT_LINKS.upgrade_to_8,
        style: 'secondary',
      },
    ];
  }

  // Discovery call client — no sessions yet, no series cards
  return [];
}

export default function QuickActions({ client, onBookSession }: QuickActionsProps) {
  const [showInitialChoice, setShowInitialChoice] = useState(false);
  const hasHadInitial = client.sessionsCompleted > 0 || client.seriesType !== 'none';
  const bookingLabel = hasHadInitial ? 'Book Follow-up Session' : 'Book Initial Session';

  // Follow-ups use the custom in-portal booking modal.
  // Initial session expands an inline In Person / Virtual choice.
  const bookingAction: Action = hasHadInitial
    ? {
        icon: Calendar,
        label: bookingLabel,
        description: 'Schedule your next in-person or virtual session',
        onClick: onBookSession,
        style: 'primary',
      }
    : {
        icon: Calendar,
        label: bookingLabel,
        description: 'Start your journey with a 90-min session',
        onClick: () => setShowInitialChoice(true),
        style: 'primary',
      };

  const livingPracticeAction: Action = {
    icon: Play,
    label: 'Living Practice',
    description: client.hasLivingPractice
      ? 'Continue your video program'
      : 'Add the standalone video program ($347)',
    href: client.hasLivingPractice
      ? LIVING_PRACTICE_COURSE_URL
      : PAYMENT_LINKS.living_practice,
    style: 'secondary',
    // Always clickable now — either go to course or purchase
    disabled: false,
  };

  const contactAction: Action = {
    icon: MessageCircle,
    label: 'Contact Dr. Garrett',
    description: 'Questions about your care?',
    href: 'mailto:hello@amarimethod.com',
    style: 'secondary',
  };

  const seriesActions = getSeriesActions(client);

  const actions: Action[] = [
    bookingAction,
    ...seriesActions,
    livingPracticeAction,
    contactAction,
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {actions.map((action) => {
          const Icon = action.icon;
          const isDisabled = !!action.disabled;
          const isBookingCard = action.label === bookingLabel && !hasHadInitial;

          // Initial session card — expands to show In Person / Virtual choice
          if (isBookingCard) {
            return (
              <div key={action.label} className={`portal-card border-amari-charcoal`}>
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

          const content = (
            <div
              className={`portal-card flex items-start gap-4 ${
                isDisabled ? 'opacity-50 cursor-default' : 'cursor-pointer hover:shadow-card-hover'
              } ${action.style === 'primary' ? 'border-amari-charcoal' : ''}`}
            >
              <div
                className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                  action.style === 'primary'
                    ? 'bg-amari-charcoal text-white'
                    : 'bg-amari-light-sand text-amari-charcoal'
                }`}
              >
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

          // Button-style action (opens modal)
          if (action.onClick) {
            return (
              <button
                key={action.label}
                onClick={action.onClick}
                className="text-left no-underline w-full"
              >
                {content}
              </button>
            );
          }

          // Disabled or no href
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
    </>
  );
}
