import { Calendar, ShoppingBag, Play, MessageCircle } from 'lucide-react';
import type { ClientData } from '../types/portal';

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

// Series purchase URLs (placeholder until GHL checkout pages are created)
const SERIES_URLS = {
  '4-session': '#', // TODO: Replace with GHL checkout URL
  '8-session': '#', // TODO: Replace with GHL checkout URL
};

const LIVING_PRACTICE_URL = 'https://groups.amarimethod.com/courses/offers/e339a945-b4f8-49d5-8c13-36c83a1e1afd';

export default function QuickActions({ client }: QuickActionsProps) {
  const hasHadInitial = client.sessionsCompleted > 0 || client.seriesType !== 'none';
  const bookingUrl = hasHadInitial ? BOOKING_URLS.followup : BOOKING_URLS.initial_inperson;
  const bookingLabel = hasHadInitial ? 'Book Follow-up' : 'Book Initial Session';

  const actions = [
    {
      icon: Calendar,
      label: bookingLabel,
      description: hasHadInitial
        ? 'Schedule your next session'
        : 'Start your journey with a 90-min session',
      href: bookingUrl,
      style: 'primary' as const,
    },
    {
      icon: ShoppingBag,
      label: 'Purchase Series',
      description: client.seriesType !== 'none'
        ? `You're on a ${client.seriesType} series`
        : 'Save with a 4 or 8-session package',
      href: client.seriesType !== 'none' ? undefined : SERIES_URLS['4-session'],
      style: 'secondary' as const,
      disabled: client.seriesType !== 'none',
    },
    {
      icon: Play,
      label: 'Living Practice',
      description: client.hasLivingPractice
        ? 'Continue your video program'
        : 'Included with 8-Session Series',
      href: client.hasLivingPractice ? LIVING_PRACTICE_URL : undefined,
      style: 'secondary' as const,
      disabled: !client.hasLivingPractice,
    },
    {
      icon: MessageCircle,
      label: 'Contact Dr. Garrett',
      description: 'Questions about your care?',
      href: 'mailto:hello@amarimethod.com',
      style: 'secondary' as const,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {actions.map((action) => {
        const Icon = action.icon;
        const isDisabled = action.disabled;

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
  );
}
