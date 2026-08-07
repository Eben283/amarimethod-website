import { CalendarClock, CarFront, ExternalLink, MapPin, RefreshCw } from 'lucide-react';
import type { ParkingSnapshot } from '../types/cos';

interface Props {
  parking: ParkingSnapshot | null;
  isLoading: boolean;
  error: string;
  onRefresh: () => void;
}

function formatDate(value: string | null, withWeekday = false) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    ...(withWeekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function ruleName(type: string) {
  return type.replace(/_/g, ' ');
}

export default function ParkingHome({ parking, isLoading, error, onRefresh }: Props) {
  if (isLoading) {
    return <div className="parking-home-skeleton" aria-label="Loading saved parking" />;
  }

  if (!parking) {
    return (
      <section className="parking-home parking-empty">
        <div className="parking-kicker"><CarFront className="w-4 h-4" /> Current parking</div>
        <h2>No parking saved</h2>
        <p>Tell COS where you parked to pin the address and its rules here.</p>
        {error && <button type="button" onClick={onRefresh} className="parking-text-button">Try again</button>}
      </section>
    );
  }

  const parkedAt = formatDate(parking.parked_at);
  const moveBy = parking.move_by_label || formatDate(parking.deadline_iso, true);
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${parking.location}, San Francisco, CA`)}`;

  return (
    <section className="parking-home animate-fade-in" aria-label="Current parking">
      <div className="parking-topline">
        <div className="parking-kicker"><CarFront className="w-4 h-4" /> Current parking</div>
        <button type="button" onClick={onRefresh} className="parking-refresh" aria-label="Refresh saved parking">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="parking-address">
        <h2>{parking.location}</h2>
        <p>{parking.side ? `${parking.side} side` : 'Side not saved'}{parkedAt ? ` · parked ${parkedAt}` : ''}</p>
      </div>

      <div className="parking-deadline">
        <CalendarClock className="w-5 h-5" />
        <div>
          <span>Move by</span>
          <strong>{moveBy || 'No move-by time saved'}</strong>
        </div>
      </div>

      <div className="parking-rules">
        <div className="parking-section-label">Rules for this block</div>
        {parking.rules.length > 0 ? parking.rules.map((rule, index) => (
          <div className="parking-rule" key={`${rule.type}-${rule.detail || ''}-${index}`}>
            <span>{ruleName(rule.type)}</span>
            <strong>{rule.detail || 'Details not saved'}</strong>
          </div>
        )) : (
          <p className="parking-muted">No rule was saved with this parking record.</p>
        )}
      </div>

      <a className="parking-map" href={mapUrl} target="_blank" rel="noreferrer" aria-label={`Open ${parking.location} in Maps`}>
        <div className="parking-map-grid" aria-hidden="true">
          <span className="parking-road parking-road-horizontal" />
          <span className="parking-road parking-road-vertical" />
          <MapPin className="parking-map-pin" />
          <span className="parking-north">N</span>
        </div>
        <div className="parking-map-copy">
          <span>Parking pin</span>
          <strong>Open in Maps <ExternalLink className="w-3.5 h-3.5" /></strong>
        </div>
      </a>
    </section>
  );
}
