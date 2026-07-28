import { test, expect } from '@playwright/test';
import { mountAsUser } from './helpers/mount-as-user';
import type { PortalDataResponse } from '../src/types/portal';

const practiceClient: PortalDataResponse = {
  client: {
    contactId: 'practice-client',
    firstName: 'Maya',
    lastName: 'Rivera',
    email: 'maya@example.com',
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
  },
  appointments: [],
  upcomingAppointments: [
    {
      id: 'practice-next',
      title: 'Follow-up session',
      startTime: new Date(Date.now() + 2 * 86400000).toISOString(),
      endTime: new Date(Date.now() + 2 * 86400000 + 50 * 60000).toISOString(),
      status: 'confirmed',
      appointmentType: 'Follow-up In-Person',
    },
  ],
};

test.describe('12-week Amari Practice portal', () => {
  test('shows the dedicated Practice home, not the legacy package dashboard', async ({ page }) => {
    await mountAsUser(page, practiceClient);

    await expect(page.getByRole('heading', { name: /12-Week Amari Practice/i })).toBeVisible();
    await expect(page.getByText('16 visits remaining')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open Living Practice/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Your next session/i })).toHaveCount(0);
  });
});
