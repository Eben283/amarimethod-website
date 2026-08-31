-- Admit the existing Partnership Discovery calendar to owned appointment
-- command capture. This is service identity only: GHL remains the provider and
-- continues to own prospect tags, partner decisions, notifications, and the
-- downstream complimentary-session lifecycle.

INSERT INTO services (
  id, name, service_family, duration_minutes, package_eligible,
  provider_calendar_id, active, buffer_minutes, start_interval_minutes
) VALUES (
  'partnership-discovery', 'Partnership Discovery Call',
  'partnership_discovery', 15, 0, 'aVE54Qf4lrbYTB0zFqXy', 1, 10, 15
);
