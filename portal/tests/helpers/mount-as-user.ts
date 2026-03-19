import type { Page } from '@playwright/test';
import type { PortalDataResponse } from '../../src/types/portal';

/**
 * Sets up localStorage auth tokens and intercepts /api/portal-data,
 * then navigates to /portal/ and waits for the dashboard to render.
 */
export async function mountAsUser(page: Page, scenario: PortalDataResponse): Promise<void> {
  // Inject auth tokens before page loads so AuthContext finds them on mount
  await page.addInitScript((data) => {
    localStorage.setItem('portal_token', 'test-session-token');
    localStorage.setItem('portal_token_expiry', String(Date.now() + 86400000)); // 24h from now
    localStorage.setItem('portal_contact_id', data.client.contactId);
    localStorage.setItem('portal_email', data.client.email);
  }, scenario);

  // Intercept portal-data API and return the fixture
  await page.route('**/api/portal-data', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scenario),
    })
  );

  // Also intercept portal-slots and portal-book so no real GHL calls happen
  await page.route('**/api/portal-slots**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slots: [] }) })
  );
  await page.route('**/api/portal-book', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        appointment: {
          id: 'test-appt-id',
          title: 'Follow-up Session (In Person)',
          startTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          sessionType: 'in-person',
        },
      }),
    })
  );

  await page.goto('/portal/');
  await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
}
