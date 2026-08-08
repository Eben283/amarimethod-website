import { test, expect } from '@playwright/test';
import { mountAsUser } from './helpers/mount-as-user';
import {
  S1_BRAND_NEW, S2_AFTER_INITIAL, S6_4_SESSION_COMPLETE,
} from './fixtures/synthetic-users';

test.describe('Portal commercial boundaries', () => {
  test('does not expose legacy series checkout from any member state', async ({ page }) => {
    await mountAsUser(page, S1_BRAND_NEW);
    await expect(page.locator('a[href*="4-session-series"], a[href*="8-session-series"]')).toHaveCount(0);
    await expect(page.getByText('$720')).toHaveCount(0);
    await expect(page.getByText('$1,295')).toHaveCount(0);

    await mountAsUser(page, S2_AFTER_INITIAL);
    await expect(page.locator('a[href*="4-session-series"], a[href*="8-session-series"]')).toHaveCount(0);

    await mountAsUser(page, S6_4_SESSION_COMPLETE);
    await expect(page.getByRole('link', { name: /Contact Amari/i })).toBeVisible();
    await expect(page.locator('a[href*="4-session-series"], a[href*="8-session-series"]')).toHaveCount(0);
  });
});
