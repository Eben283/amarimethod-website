// Synthetic data for previewing the portal without auth.
// Triggered by ?preview=<state> on the URL.
import type { PortalDataResponse, Appointment } from '../types/portal';

export type PreviewState =
  | 'empty'        // brand new, no purchases
  | 'active'       // pay-as-you-go (no series, has past sessions)
  | 'series'       // mid 8-pack (4 done, 4 left)
  | 'practice'     // mid 12-week Amari Practice
  | 'last-left'    // 1 session left, soft re-up prompt
  | 'completed'    // 0 left, time to re-up
  | 'reup'         // mid second package, lifetime > package size
  | 'low-confidence' // ledger ambiguity flagged
  | 'loading'
  | 'error';

const VALID_STATES: PreviewState[] = [
  'empty', 'active', 'series', 'practice', 'last-left', 'completed', 'reup', 'low-confidence', 'loading', 'error',
];

export function getPreviewState(): PreviewState | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const p = params.get('preview');
  if (!p) return null;
  if ((VALID_STATES as string[]).includes(p)) {
    return p as PreviewState;
  }
  return null;
}

function addDays(d: Date, days: number, hour = 10, minute = 0): string {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  x.setHours(hour, minute, 0, 0);
  return x.toISOString();
}

function subDays(d: Date, days: number, hour = 10, minute = 0): string {
  return addDays(d, -days, hour, minute);
}

export function getPreviewData(state: PreviewState): PortalDataResponse | null {
  if (state === 'loading' || state === 'error') return null;
  const now = new Date();

  if (state === 'empty') {
    return {
      client: {
        contactId: 'preview-empty',
        firstName: 'Eben',
        lastName: '',
        email: 'preview@amarimethod.com',
        seriesType: 'none',
        sessionsCompleted: 0,
        sessionsRemaining: 0,
        packageSize: 0,
        attendedAgainstPackage: 0,
        ledgerConfidence: 'high',
        ledgerSource: 'empty',
        hasLivingPractice: false,
        portalAccess: true,
        isPartner: false,
        isFoundersCircle: true,
      },
      appointments: [],
      upcomingAppointments: [],
    };
  }

  if (state === 'active') {
    const next: Appointment = {
      id: 'a-next',
      title: 'Follow-up session',
      startTime: addDays(now, 4, 11, 20),
      endTime: addDays(now, 4, 12, 10),
      status: 'confirmed',
      appointmentType: 'Follow-up Virtual',
      meetingUrl: 'https://meet.google.com/preview-xxx-yyy',
    };
    const later: Appointment = {
      id: 'a-later',
      title: 'Follow-up session',
      startTime: addDays(now, 11, 11, 20),
      endTime: addDays(now, 11, 12, 10),
      status: 'confirmed',
      appointmentType: 'Follow-up Virtual',
    };
    const past: Appointment[] = [
      { id: 'a-p1', title: 'Initial assessment', startTime: subDays(now, 7, 10, 0), endTime: subDays(now, 7, 11, 0), status: 'completed', appointmentType: 'Initial In-Person' },
      { id: 'a-p2', title: 'Discovery call', startTime: subDays(now, 14, 11, 40), endTime: subDays(now, 14, 11, 55), status: 'completed', appointmentType: 'Discovery Virtual' },
    ];
    return {
      client: {
        contactId: 'preview-active',
        firstName: 'Eben',
        lastName: '',
        email: 'preview@amarimethod.com',
        seriesType: 'none',
        sessionsCompleted: 2,
        sessionsRemaining: 0,
        packageSize: 0,
        attendedAgainstPackage: 0,
        ledgerConfidence: 'high',
        ledgerSource: 'empty',
        hasLivingPractice: false,
        portalAccess: true,
        isPartner: false,
        isFoundersCircle: true,
      },
      appointments: past,
      upcomingAppointments: [next, later],
    };
  }

  if (state === 'series') {
    const next: Appointment = {
      id: 'a-next',
      title: 'Follow-up session',
      startTime: addDays(now, 1, 10, 0),
      endTime: addDays(now, 1, 10, 50),
      status: 'confirmed',
      appointmentType: 'Follow-up In-Person',
    };
    const more: Appointment[] = [
      { id: 'a-m1', title: 'Follow-up session', startTime: addDays(now, 8, 10, 0), endTime: addDays(now, 8, 10, 50), status: 'confirmed', appointmentType: 'Follow-up In-Person' },
      { id: 'a-m2', title: 'Follow-up session', startTime: addDays(now, 15, 10, 0), endTime: addDays(now, 15, 10, 50), status: 'confirmed', appointmentType: 'Follow-up In-Person' },
      { id: 'a-m3', title: 'Follow-up session', startTime: addDays(now, 22, 10, 0), endTime: addDays(now, 22, 10, 50), status: 'confirmed', appointmentType: 'Follow-up Virtual' },
    ];
    const past: Appointment[] = [
      { id: 'p1', title: 'Follow-up session', startTime: subDays(now, 7, 10, 0), endTime: subDays(now, 7, 10, 50), status: 'completed', appointmentType: 'Follow-up In-Person' },
      { id: 'p2', title: 'Follow-up session', startTime: subDays(now, 14, 10, 0), endTime: subDays(now, 14, 10, 50), status: 'completed', appointmentType: 'Follow-up In-Person' },
      { id: 'p3', title: 'Follow-up session', startTime: subDays(now, 21, 10, 0), endTime: subDays(now, 21, 10, 50), status: 'completed', appointmentType: 'Follow-up In-Person' },
      { id: 'p4', title: 'Follow-up — rescheduled', startTime: subDays(now, 24, 15, 30), endTime: subDays(now, 24, 16, 20), status: 'cancelled', appointmentType: 'Follow-up In-Person' },
      { id: 'p5', title: 'Initial assessment', startTime: subDays(now, 28, 10, 0), endTime: subDays(now, 28, 11, 0), status: 'completed', appointmentType: 'Initial In-Person' },
    ];
    return {
      client: {
        contactId: 'preview-series',
        firstName: 'Eben',
        lastName: '',
        email: 'preview@amarimethod.com',
        seriesType: '8-session',
        sessionsCompleted: 4,
        sessionsRemaining: 4,
        packageSize: 8,
        attendedAgainstPackage: 4,
        ledgerConfidence: 'high',
        ledgerSource: 'orders+invoices+appointments',
        hasLivingPractice: true,
        portalAccess: true,
        isPartner: false,
        isFoundersCircle: true,
      },
      appointments: past,
      upcomingAppointments: [next, ...more],
    };
  }

  if (state === 'practice') {
    const next: Appointment = {
      id: 'practice-next',
      title: 'Follow-up session',
      startTime: addDays(now, 2, 10, 0),
      endTime: addDays(now, 2, 10, 50),
      status: 'confirmed',
      appointmentType: 'Follow-up In-Person',
    };
    const later: Appointment = {
      id: 'practice-later',
      title: 'Follow-up session',
      startTime: addDays(now, 5, 14, 0),
      endTime: addDays(now, 5, 14, 50),
      status: 'confirmed',
      appointmentType: 'Follow-up In-Person',
    };
    const past: Appointment[] = Array.from({ length: 8 }, (_, i) => ({
      id: `practice-past-${i}`,
      title: 'Follow-up session',
      startTime: subDays(now, (8 - i) * 6, 10, 0),
      endTime: subDays(now, (8 - i) * 6, 10, 50),
      status: 'completed',
      appointmentType: 'Follow-up In-Person',
    }));
    return {
      client: {
        contactId: 'preview-practice',
        firstName: 'Maya',
        lastName: '',
        email: 'preview@amarimethod.com',
        seriesType: '12-week',
        sessionsCompleted: 8,
        sessionsRemaining: 16,
        packageSize: 24,
        attendedAgainstPackage: 8,
        ledgerConfidence: 'high',
        ledgerSource: 'orders+invoices+appointments',
        hasLivingPractice: true,
        portalAccess: true,
        isPartner: false,
        isFoundersCircle: false,
      },
      appointments: past,
      upcomingAppointments: [next, later],
    };
  }

  if (state === 'last-left') {
    // 7 done, 1 left in 8-pack. Soft re-up prompt should show.
    const past: Appointment[] = Array.from({ length: 7 }).map((_, i) => ({
      id: `ll-${i}`,
      title: 'Follow-up session',
      startTime: subDays(now, (7 - i) * 7, 10, 0),
      endTime: subDays(now, (7 - i) * 7, 10, 50),
      status: 'completed',
      appointmentType: 'Follow-up In-Person',
    }));
    return {
      client: {
        contactId: 'preview-last-left',
        firstName: 'Eben',
        lastName: '',
        email: 'preview@amarimethod.com',
        seriesType: '8-session',
        sessionsCompleted: 7,
        sessionsRemaining: 1,
        packageSize: 8,
        attendedAgainstPackage: 7,
        ledgerConfidence: 'high',
        ledgerSource: 'orders+invoices+appointments',
        hasLivingPractice: true,
        portalAccess: true,
        isPartner: false,
        isFoundersCircle: true,
      },
      appointments: past,
      upcomingAppointments: [],
    };
  }

  if (state === 'reup') {
    // Mid second package: 12 lifetime done, 8 attended against current package,
    // 0 left of current — JUST FINISHED, would re-up. Use lifetime > packageSize
    // to test the journey display growing past the pack size.
    const past: Appointment[] = Array.from({ length: 12 }).map((_, i) => ({
      id: `ru-${i}`,
      title: 'Follow-up session',
      startTime: subDays(now, (12 - i) * 7, 10, 0),
      endTime: subDays(now, (12 - i) * 7, 10, 50),
      status: 'completed',
      appointmentType: 'Follow-up In-Person',
    }));
    return {
      client: {
        contactId: 'preview-reup',
        firstName: 'Eben',
        lastName: '',
        email: 'preview@amarimethod.com',
        seriesType: '8-session',
        sessionsCompleted: 12,
        sessionsRemaining: 4,
        packageSize: 16, // 8 + 8 re-up
        attendedAgainstPackage: 12,
        ledgerConfidence: 'high',
        ledgerSource: 'orders+invoices+appointments',
        hasLivingPractice: true,
        portalAccess: true,
        isPartner: false,
        isFoundersCircle: true,
      },
      appointments: past,
      upcomingAppointments: [],
    };
  }

  if (state === 'low-confidence') {
    // Ledger flagged an ambiguity (e.g. custom field disagrees). Surface
    // "contact Garrett" gentle prompt.
    return {
      client: {
        contactId: 'preview-low-confidence',
        firstName: 'Eben',
        lastName: '',
        email: 'preview@amarimethod.com',
        seriesType: '8-session',
        sessionsCompleted: 5,
        sessionsRemaining: 2, // derived, but flagged as low-confidence
        packageSize: 8,
        attendedAgainstPackage: 5,
        ledgerConfidence: 'low',
        ledgerSource: 'orders+invoices+appointments',
        hasLivingPractice: true,
        portalAccess: true,
        isPartner: false,
        isFoundersCircle: true,
      },
      appointments: [],
      upcomingAppointments: [],
    };
  }

  // completed
  const past: Appointment[] = Array.from({ length: 8 }).map((_, i) => ({
    id: `done-${i}`,
    title: 'Follow-up session',
    startTime: subDays(now, (8 - i) * 7, 10, 0),
    endTime: subDays(now, (8 - i) * 7, 10, 50),
    status: 'completed',
    appointmentType: 'Follow-up In-Person',
  }));
  return {
    client: {
      contactId: 'preview-completed',
      firstName: 'Eben',
      lastName: '',
      email: 'preview@amarimethod.com',
      seriesType: '8-session',
      sessionsCompleted: 8,
      sessionsRemaining: 0,
      packageSize: 8,
      attendedAgainstPackage: 8,
      ledgerConfidence: 'high',
      ledgerSource: 'orders+invoices+appointments',
      hasLivingPractice: true,
      portalAccess: true,
      isPartner: false,
        isFoundersCircle: true,
    },
    appointments: past,
    upcomingAppointments: [],
  };
}
