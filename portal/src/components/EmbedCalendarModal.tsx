import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, Video, Phone } from 'lucide-react';

/**
 * LEGACY — GHL iframe calendar wrapper.
 * Do not use for new booking UI. Prefer portal BookingModal (native Amari calendar).
 * See SYSTEM.md ("Canonical calendar" + EmbedCalendarModal row).
 */

const EMBED_SCRIPT_URL = 'https://link.amarimethod.com/js/form_embed.js';
const SCRIPT_ID = 'ghl-form-embed-script';

const CALENDAR_CONFIGS = {
  // Pre-paid series clients (session already paid for in the series)
  prepaid_inperson: {
    src: 'https://link.amarimethod.com/widget/booking/ZO1jlGfy01rsxVqicoSB',
    iframeId: 'ZO1jlGfy01rsxVqicoSB_portal',
    label: 'Book In-Person Session',
    Icon: MapPin,
  },
  prepaid_virtual: {
    src: 'https://link.amarimethod.com/widget/booking/bJFkhVP35Ecwh4tLnSmy',
    iframeId: 'bJFkhVP35Ecwh4tLnSmy_portal',
    label: 'Book Virtual Session',
    Icon: Video,
  },
  // Pay-as-you-go clients (book + pay $190 in one step)
  followup_inperson: {
    src: 'https://link.amarimethod.com/widget/booking/SKDVOL8wtUN6Ne0ppbC9',
    iframeId: 'SKDVOL8wtUN6Ne0ppbC9_portal',
    label: 'Book In-Person Follow-up',
    Icon: MapPin,
  },
  followup_virtual: {
    src: 'https://link.amarimethod.com/widget/booking/oVn77FcecFY16iS2pHyP',
    iframeId: 'oVn77FcecFY16iS2pHyP_portal',
    label: 'Book Virtual Follow-up',
    Icon: Video,
  },
  // Free discovery call
  discovery: {
    src: 'https://link.amarimethod.com/widget/booking/USgPsktqRcuomdUgpShL',
    iframeId: 'USgPsktqRcuomdUgpShL_portal',
    label: 'Book a Free Discovery Call',
    Icon: Phone,
  },
} as const;

export type EmbedCalendarType = keyof typeof CALENDAR_CONFIGS;

interface EmbedCalendarModalProps {
  calendarType: EmbedCalendarType;
  onClose: () => void;
}

export default function EmbedCalendarModal({ calendarType, onClose }: EmbedCalendarModalProps) {
  const config = CALENDAR_CONFIGS[calendarType];
  const { Icon } = config;

  // Load GHL form embed script on mount (lazy — only when modal is opened)
  useEffect(() => {
    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = EMBED_SCRIPT_URL;
      script.type = 'text/javascript';
      document.body.appendChild(script);
    }
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Render via portal at document.body to escape any ancestor stacking context
  // created by CSS animations (animate-fade-in uses opacity/transform which
  // confines z-index to that subtree — fixed + z-50 alone are not enough).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full"
        style={{ maxWidth: '640px', maxHeight: '85vh', overflowY: 'auto' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amari-charcoal text-white flex-shrink-0">
              <Icon className="w-4 h-4" />
            </div>
            <h2 className="font-sans font-semibold text-amari-charcoal text-base">
              {config.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-amari-text-muted hover:text-amari-charcoal hover:bg-amari-light-sand transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Embedded GHL booking calendar */}
        <div>
          <iframe
            src={config.src}
            style={{
              width: '100%',
              border: 'none',
              overflow: 'hidden',
              minHeight: '750px',
              display: 'block',
            }}
            scrolling="no"
            id={config.iframeId}
            title={config.label}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
