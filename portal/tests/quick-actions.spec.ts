import { test, expect } from '@playwright/test';
import { mountAsUser } from './helpers/mount-as-user';
import {
  S1_BRAND_NEW, S2_AFTER_INITIAL, S3_NINE_SESSIONS,
  S4_FRESH_4_SESSION, S5_ACTIVE_4_MID, S6_4_SESSION_COMPLETE,
  S7_ACTIVE_8_MID, S8_8_SESSION_COMPLETE,
  S10_PARTNER,
} from './fixtures/synthetic-users';

test.describe('QuickActions — booking label', () => {

  test('S1 brand new → "Book your initial session"', async ({ page }) => {
    await mountAsUser(page, S1_BRAND_NEW);
    await expect(page.getByTestId('booking-label')).toHaveText('Book your initial session');
  });

  test('S2 after initial → "Book a follow-up session"', async ({ page }) => {
    await mountAsUser(page, S2_AFTER_INITIAL);
    await expect(page.getByTestId('booking-label')).toHaveText('Book a follow-up session');
  });

  test('S4 fresh series (0 done) → "Book your initial session" (hasHadInitial=false)', async ({ page }) => {
    await mountAsUser(page, S4_FRESH_4_SESSION);
    // hasHadInitial = sessionsCompleted > 0 = false → shows initial booking
    await expect(page.getByTestId('booking-label')).toHaveText('Book your initial session');
  });

  test('S5 active series → "Book your next session"', async ({ page }) => {
    await mountAsUser(page, S5_ACTIVE_4_MID);
    await expect(page.getByTestId('booking-label')).toHaveText('Book your next session');
  });

  test('S6 series complete (pay-as-you-go) → "Book a follow-up session"', async ({ page }) => {
    await mountAsUser(page, S6_4_SESSION_COMPLETE);
    await expect(page.getByTestId('booking-label')).toHaveText('Book a follow-up session');
  });

});

test.describe('QuickActions — series cards (upgrade vs standard)', () => {

  test('S1 brand new → standard series cards, no upgrade cards', async ({ page }) => {
    await mountAsUser(page, S1_BRAND_NEW);
    await expect(page.getByTestId('series-4-card')).toBeVisible();
    await expect(page.getByTestId('series-8-card')).toBeVisible();
    await expect(page.getByTestId('upgrade-to-4-card')).not.toBeVisible();
    await expect(page.getByTestId('upgrade-to-8-card')).not.toBeVisible();
    // Brand-new copy (no initial session yet)
    await expect(page.getByTestId('series-4-card-desc')).toContainText('initial session purchased separately');
  });

  test('S2 after initial → upgrade cards shown, standard series cards hidden', async ({ page }) => {
    await mountAsUser(page, S2_AFTER_INITIAL);
    await expect(page.getByTestId('upgrade-to-4-card')).toBeVisible();
    await expect(page.getByTestId('upgrade-to-8-card')).toBeVisible();
    await expect(page.getByTestId('series-4-card')).not.toBeVisible();
    await expect(page.getByTestId('series-8-card')).not.toBeVisible();
    // Upgrade copy confirms credit applied
    await expect(page.getByTestId('upgrade-to-4-card-desc')).toContainText('$225 is already applied');
  });

  test('S3 nine sessions → standard cards, established copy', async ({ page }) => {
    await mountAsUser(page, S3_NINE_SESSIONS);
    await expect(page.getByTestId('series-4-card')).toBeVisible();
    await expect(page.getByTestId('upgrade-to-4-card')).not.toBeVisible();
    await expect(page.getByTestId('series-4-card-desc')).toContainText('Maintain and evolve');
  });

  test('S5 active series → standard cards, established copy', async ({ page }) => {
    await mountAsUser(page, S5_ACTIVE_4_MID);
    await expect(page.getByTestId('series-4-card')).toBeVisible();
    await expect(page.getByTestId('upgrade-to-4-card')).not.toBeVisible();
    await expect(page.getByTestId('series-4-card-desc')).toContainText('Maintain and evolve');
  });

  test('S10 partner with 3 sessions → NO upgrade cards (isPartner guard)', async ({ page }) => {
    await mountAsUser(page, S10_PARTNER);
    // Even if sessionsCompleted were 1, isPartner blocks upgrade cards
    await expect(page.getByTestId('upgrade-to-4-card')).not.toBeVisible();
    await expect(page.getByTestId('upgrade-to-8-card')).not.toBeVisible();
  });

});

test.describe('QuickActions — Living Practice card', () => {

  test('S1 no LP access → shows purchase price', async ({ page }) => {
    await mountAsUser(page, S1_BRAND_NEW);
    await expect(page.getByTestId('living-practice-card-desc')).toContainText('$347');
    await expect(page.getByTestId('living-practice-card-desc')).not.toContainText('Continue');
  });

  test('S7 active 8-session → LP access link (not purchase)', async ({ page }) => {
    await mountAsUser(page, S7_ACTIVE_8_MID);
    await expect(page.getByTestId('living-practice-card-desc')).toContainText('Continue your video program');
    await expect(page.getByTestId('living-practice-card-desc')).not.toContainText('$347');
  });

  test('S8 8-session complete → LP access link', async ({ page }) => {
    await mountAsUser(page, S8_8_SESSION_COMPLETE);
    await expect(page.getByTestId('living-practice-card-desc')).toContainText('Continue your video program');
  });

});

test.describe('QuickActions — partner toolkit card', () => {

  test('S1 non-partner → no partner toolkit card', async ({ page }) => {
    await mountAsUser(page, S1_BRAND_NEW);
    await expect(page.getByTestId('partner-toolkit-card')).not.toBeVisible();
  });

  test('S10 partner → partner toolkit card visible', async ({ page }) => {
    await mountAsUser(page, S10_PARTNER);
    await expect(page.getByTestId('partner-toolkit-card')).toBeVisible();
  });

});
