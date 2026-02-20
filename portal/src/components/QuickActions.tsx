import { useState } from 'react';
import { Calendar, ShoppingBag, Play, MessageCircle, TrendingUp } from 'lucide-react';
import type { ClientData } from '../types/portal';
import BookingModal from './BookingModal';

interface QuickActionsProps {
  client: ClientData;
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
  const { seriesType, sessionsCompleted, hasLivingPractice } = client;

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
        description: 'Add Living Practice + 4 more sessions — pay the difference ($475)',
        href: PAYMENT_LINKS.upgrade_4_to_8,
        style: 'secondary',
      },
    ];
  }

  // No active series but has had sessions — show upgrade pricing
  if (sessionsCompleted >= 1) {
    return [
      {
        icon: ShoppingBag,
        label: 'Upgrade to 4-Session Series',
        description: 'Apply your initial session — pay the difference ($545)',
        href: PAYMENT_LINKS.upgrade_to_4,
        style: 'secondary',
      },
      {
        icon: TrendingUp,
        label: 'Upgrade to 8-Session Series',
        description: 'Apply your initial session + get Living Practice ($1,020)',
        href: PAYMENT_LINKS.upgrade_to_8,
        style: 'secondary',
      },
    ];
  }

  // Brand new client — no sessions yet, show full prices
  return [
    {
      icon: ShoppingBag,
      label: '4-Session Series',
      description: 'Four sessions — save vs. individual pricing ($820)',
      href: PAYMENT_LINKS.series_4,
      style: 'secondary',
    },
    {
      icon: TrendingUp,
      label: '8-Session Series',
      description: 'Eight sessions + Living Practice video program ($1,295)',
      href: PAYMENT_LINKS.series_8,
      style: 'secondary',
    },
  ];
}

export default function QuickActions({ client }: QuickActionsProps) {
  const [showBookingModal, setShowBookingModal] = useState(false);

  const hasHadInitial = client.sessionsCompleted > 0 || client.seriesType !== 'none';
  const bookingLabel = hasHadInitial ? 'Book Follow-up Session' : 'Book Initial Session';

  // Follow-ups use the custom in-portal booking modal.
  // Initial session still goes to the external GHL page.
  const bookingAction: Action = hasHadInitial
    ? {
        icon: Calendar,
        label: bookingLabel,
        description: 'Schedule your next in-person or virtual session',
        onClick: () => setShowBookingModal(true),
        style: 'primary',
      }
    : {
        icon: Calendar,
        label: bookingLabel,
        description: 'Start your journey with a 90-min session',
        href: BOOKING_URLS.initial_inperson,
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
      {showBookingModal && (
        <BookingModal onClose={() => setShowBookingModal(false)} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {actions.map((action) => {
          const Icon = action.icon;
          const isDisabled = !!action.disabled;

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
