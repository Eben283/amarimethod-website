import { test, expect } from '@playwright/test';
import { mountAsUser } from './helpers/mount-as-user';
import type { PortalDataResponse } from '../src/types/portal';

const foundersClient: PortalDataResponse = {
  client: {
    contactId: 'founders-client',
    firstName: 'Alex',
    lastName: 'Chen',
    email: 'alex@example.com',
    seriesType: '8-session',
    sessionsCompleted: 3,
    sessionsRemaining: 5,
    packageSize: 8,
    attendedAgainstPackage: 3,
    ledgerConfidence: 'high',
    ledgerSource: 'orders+invoices+appointments',
    hasLivingPractice: true,
    portalAccess: true,
    isPartner: false,
    isFoundersCircle: true,
  },
  appointments: [],
  upcomingAppointments: [],
};

const untaggedSeriesClient: PortalDataResponse = {
  ...foundersClient,
  client: {
    ...foundersClient.client,
    contactId: 'untagged-series',
    isFoundersCircle: false,
  },
};

test.describe('Founders Circle portal routing', () => {
  test('tagged Founders Circle clients stay on the legacy dashboard (not Practice home)', async ({ page }) => {
    await mountAsUser(page, foundersClient);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: /12-Week Amari Practice|6-Week Amari Practice|Your Amari visits/i })).toHaveCount(0);
  });

  test('untagged clients see Practice home without pack repurchase prices', async ({ page }) => {
    await mountAsUser(page, untaggedSeriesClient);
    await expect(page.getByRole('heading', { name: /Your Amari visits/i })).toBeVisible();
    await expect(page.getByText('$720')).toHaveCount(0);
    await expect(page.getByText('$1,295')).toHaveCount(0);
  });
});
