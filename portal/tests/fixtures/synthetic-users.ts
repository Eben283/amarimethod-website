import type { PortalDataResponse, Appointment } from '../../src/types/portal';

function appt(id: string, status: Appointment['status'], daysAgo: number): Appointment {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return {
    id,
    title: 'Follow-up Session',
    startTime: d.toISOString(),
    endTime: new Date(d.getTime() + 50 * 60 * 1000).toISOString(),
    status,
    appointmentType: 'Follow-up Session',
  };
}

function upcoming(id: string, daysFromNow: number): Appointment {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return {
    id,
    title: 'Follow-up Session',
    startTime: d.toISOString(),
    endTime: new Date(d.getTime() + 50 * 60 * 1000).toISOString(),
    status: 'confirmed',
    appointmentType: 'Follow-up Session',
  };
}

const BASE = {
  contactId: 'test-contact-123',
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  portalAccess: true,
  isPartner: false,
  referralCount: 0,
  rewardCode: null,
  hasLivingPractice: false,
};

// 1. Brand new — 0 sessions, no series
export const S1_BRAND_NEW: PortalDataResponse = {
  client: { ...BASE, seriesType: 'none', sessionsCompleted: 0, sessionsRemaining: 0 },
  appointments: [],
  upcomingAppointments: [],
};

// 2. After initial — 1 session done, no series → upgrade offer
// NOTE: payAsYouGo depends on lifetimeCompleted from appointments array, so must include past appt
export const S2_AFTER_INITIAL: PortalDataResponse = {
  client: { ...BASE, seriesType: 'none', sessionsCompleted: 1, sessionsRemaining: 0 },
  appointments: [appt('a1', 'completed', 14)],
  upcomingAppointments: [],
};

// 3. 9 sessions, no series — established pay-as-you-go client
export const S3_NINE_SESSIONS: PortalDataResponse = {
  client: { ...BASE, seriesType: 'none', sessionsCompleted: 9, sessionsRemaining: 0 },
  appointments: Array.from({ length: 9 }, (_, i) => appt(`a${i}`, 'completed', (i + 1) * 14)),
  upcomingAppointments: [],
};

// 4. Fresh 4-session series, 0 done — just purchased
export const S4_FRESH_4_SESSION: PortalDataResponse = {
  client: { ...BASE, seriesType: '4-session', sessionsCompleted: 0, sessionsRemaining: 4 },
  appointments: [],
  upcomingAppointments: [],
};

// 5. Active 4-session series, mid (2 done, 2 remaining)
export const S5_ACTIVE_4_MID: PortalDataResponse = {
  client: { ...BASE, seriesType: '4-session', sessionsCompleted: 2, sessionsRemaining: 2 },
  appointments: [appt('b1', 'completed', 28), appt('b2', 'completed', 14)],
  upcomingAppointments: [upcoming('u1', 7)],
};

// 6. 4-session series complete (0 remaining)
export const S6_4_SESSION_COMPLETE: PortalDataResponse = {
  client: { ...BASE, seriesType: '4-session', sessionsCompleted: 4, sessionsRemaining: 0 },
  appointments: Array.from({ length: 4 }, (_, i) => appt(`c${i}`, 'completed', (i + 1) * 14)),
  upcomingAppointments: [],
};

// 7. Active 8-session series, mid (4 done, 4 remaining) — LP access included
export const S7_ACTIVE_8_MID: PortalDataResponse = {
  client: { ...BASE, seriesType: '8-session', sessionsCompleted: 4, sessionsRemaining: 4, hasLivingPractice: true },
  appointments: Array.from({ length: 4 }, (_, i) => appt(`d${i}`, 'completed', (i + 1) * 14)),
  upcomingAppointments: [upcoming('u2', 7)],
};

// 8. 8-session series complete — LP access
export const S8_8_SESSION_COMPLETE: PortalDataResponse = {
  client: { ...BASE, seriesType: '8-session', sessionsCompleted: 8, sessionsRemaining: 0, hasLivingPractice: true },
  appointments: Array.from({ length: 8 }, (_, i) => appt(`e${i}`, 'completed', (i + 1) * 14)),
  upcomingAppointments: [],
};

// 9. Veteran + new 8-pack (Danny-type): 11 lifetime sessions, 7 remaining in new pack
export const S9_VETERAN_NEW_PACK: PortalDataResponse = {
  client: { ...BASE, seriesType: '8-session', sessionsCompleted: 11, sessionsRemaining: 7, hasLivingPractice: true },
  appointments: Array.from({ length: 11 }, (_, i) => appt(`f${i}`, 'completed', (i + 1) * 14)),
  upcomingAppointments: [upcoming('u3', 7)],
};

// 10. Partner — no referral card, partner toolkit shown
export const S10_PARTNER: PortalDataResponse = {
  client: { ...BASE, seriesType: 'none', sessionsCompleted: 3, sessionsRemaining: 0, isPartner: true },
  appointments: Array.from({ length: 3 }, (_, i) => appt(`g${i}`, 'completed', (i + 1) * 14)),
  upcomingAppointments: [],
};

// 11. Referral milestone — 3 referrals, reward code ready
export const S11_REFERRAL_MILESTONE: PortalDataResponse = {
  client: { ...BASE, seriesType: 'none', sessionsCompleted: 2, sessionsRemaining: 0, referralCount: 3, rewardCode: 'FREE123' },
  appointments: [appt('h1', 'completed', 30), appt('h2', 'completed', 14)],
  upcomingAppointments: [],
};

// ZACH — affiliate-partner, 4-session series, 3 remaining (1 session attended, automation gap = not decremented)
// sessionsCompleted=1 (GHL not updated after yesterday's session), isPartner=true
export const S_ZACH: PortalDataResponse = {
  client: { ...BASE, seriesType: '4-session', sessionsCompleted: 1, sessionsRemaining: 3, isPartner: true },
  appointments: [appt('z1', 'showed', 1)],   // yesterday's session — showed but GHL didn't decrement
  upcomingAppointments: [],
};

// 12. 1 session remaining in 4-session series (3 done)
export const S12_ONE_REMAINING: PortalDataResponse = {
  client: { ...BASE, seriesType: '4-session', sessionsCompleted: 3, sessionsRemaining: 1 },
  appointments: Array.from({ length: 3 }, (_, i) => appt(`i${i}`, 'completed', (i + 1) * 14)),
  upcomingAppointments: [],
};
