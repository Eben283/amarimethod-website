import { test, expect } from '@playwright/test';
import { mountAsUser } from './helpers/mount-as-user';
import {
  S1_BRAND_NEW, S2_AFTER_INITIAL, S5_ACTIVE_4_MID,
  S6_4_SESSION_COMPLETE, S8_8_SESSION_COMPLETE,
  S10_PARTNER, S11_REFERRAL_MILESTONE, S12_ONE_REMAINING,
} from './fixtures/synthetic-users';

test.describe('Dashboard — subtitle text', () => {

  test('S1 brand new → "Welcome — your portal is ready."', async ({ page }) => {
    await mountAsUser(page, S1_BRAND_NEW);
    await expect(page.getByTestId('dashboard-subtitle')).toHaveText('Welcome — your portal is ready.');
  });

  test('S2 after initial → "Welcome back" message', async ({ page }) => {
    await mountAsUser(page, S2_AFTER_INITIAL);
    await expect(page.getByTestId('dashboard-subtitle')).toContainText('Welcome back');
  });

  test('S5 active series → "2 sessions remaining"', async ({ page }) => {
    await mountAsUser(page, S5_ACTIVE_4_MID);
    await expect(page.getByTestId('dashboard-subtitle')).toHaveText('2 sessions remaining');
  });

  test('S12 one remaining → "1 session remaining" (singular)', async ({ page }) => {
    await mountAsUser(page, S12_ONE_REMAINING);
    await expect(page.getByTestId('dashboard-subtitle')).toHaveText('1 session remaining');
  });

  // Bug 5: finished series shows "0 sessions remaining" — this test SHOULD FAIL until fixed
  test('S6 4-session complete → should NOT show "0 sessions remaining"', async ({ page }) => {
    await mountAsUser(page, S6_4_SESSION_COMPLETE);
    await expect(page.getByTestId('dashboard-subtitle')).not.toContainText('0 sessions remaining');
  });

  // Bug 5: same issue for 8-session complete
  test('S8 8-session complete → should NOT show "0 sessions remaining"', async ({ page }) => {
    await mountAsUser(page, S8_8_SESSION_COMPLETE);
    await expect(page.getByTestId('dashboard-subtitle')).not.toContainText('0 sessions remaining');
  });

});

test.describe('Dashboard — referral card visibility', () => {

  test('S1 non-partner → referral card shown', async ({ page }) => {
    await mountAsUser(page, S1_BRAND_NEW);
    await expect(page.getByTestId('referral-card')).toBeVisible();
  });

  test('S10 partner → referral card hidden', async ({ page }) => {
    await mountAsUser(page, S10_PARTNER);
    await expect(page.getByTestId('referral-card')).not.toBeVisible();
  });

  test('S11 referral milestone → referral card shows reward code', async ({ page }) => {
    await mountAsUser(page, S11_REFERRAL_MILESTONE);
    await expect(page.getByTestId('referral-card')).toBeVisible();
    await expect(page.getByTestId('referral-card')).toContainText('FREE123');
    await expect(page.getByText('Your free session is ready.')).toBeVisible();
  });

});
