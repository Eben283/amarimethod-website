import { test, expect, type Page } from '@playwright/test';
import { mountAsUser } from './helpers/mount-as-user';
import { S_ZACH } from './fixtures/synthetic-users';

// Returns a slot date N days from now, guaranteed to be in the future.
function getFutureSlot(daysAhead = 10) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-indexed
  const day = d.getDate();
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const monthName = d.toLocaleString('en-US', { month: 'long' });
  return { dateStr, year, month, day, monthName };
}

// Navigate the BookingModal calendar to the month containing the slot.
// The modal starts at the current month.
async function navigateToMonth(page: Page, targetYear: number, targetMonth: number) {
  const today = new Date();
  let curYear = today.getFullYear();
  let curMonth = today.getMonth() + 1; // 1-indexed

  while (curYear < targetYear || (curYear === targetYear && curMonth < targetMonth)) {
    await page.getByTestId('next-month-btn').click();
    curMonth++;
    if (curMonth > 12) { curMonth = 1; curYear++; }
  }
}

// Full booking flow: open modal, pick slot, proceed to confirm screen.
async function proceedToConfirm(page: Page) {
  const slot = getFutureSlot(10);

  // Override portal-slots to return our specific slot
  await page.route('**/api/portal-slots**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        slots: [{
          date: slot.dateStr,
          time: '10:00',
          hour: 10,
          minute: 0,
          datetime: `${slot.dateStr}T10:00:00-07:00`,
        }],
      }),
    })
  );

  // Open the BookingModal via ProgressTracker button
  await page.getByTestId('book-next-from-progress').click();
  await expect(page.getByText('Book a Session')).toBeVisible();

  // Navigate to the correct month if the slot is not in the current month
  await navigateToMonth(page, slot.year, slot.month);

  // Click the specific calendar day
  await page.getByTestId(`calendar-day-${slot.dateStr}`).click();

  // Click the 10:00 AM time slot
  await page.getByRole('button', { name: '10:00 AM' }).click();

  // Click Continue → confirmation screen
  await page.getByRole('button', { name: 'Continue →' }).click();

  return slot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal state
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Zach — portal state', () => {

  test('subtitle shows "3 sessions remaining"', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    await expect(page.getByTestId('dashboard-subtitle')).toHaveText('3 sessions remaining');
  });

  test('progress tracker: 1 of 4 sessions, 25%, 3 remaining', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    const tracker = page.getByTestId('state-series-in-progress');
    await expect(tracker).toBeVisible();
    await expect(tracker.getByText('1 of 4 sessions')).toBeVisible();
    await expect(tracker.getByText('25%')).toBeVisible();
    await expect(tracker.getByText('3 sessions remaining')).toBeVisible();
  });

  test('booking label is "Book Follow-up Session" (has had initial)', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    await expect(page.getByTestId('booking-label')).toHaveText('Book Follow-up Session');
  });

  test('book-next button visible (no upcoming appointments)', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    await expect(page.getByTestId('book-next-from-progress')).toBeVisible();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Partner-specific UI
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Zach — partner cards', () => {

  test('referral card hidden (isPartner)', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    await expect(page.getByTestId('referral-card')).not.toBeVisible();
  });

  test('upgrade cards hidden (isPartner guard)', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    await expect(page.getByTestId('upgrade-to-4-card')).not.toBeVisible();
    await expect(page.getByTestId('upgrade-to-8-card')).not.toBeVisible();
  });

  test('partner toolkit card visible', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    await expect(page.getByTestId('partner-toolkit-card')).toBeVisible();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Booking modal — full flow
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Zach — BookingModal flow', () => {

  test('clicking book-next opens BookingModal with calendar', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    await page.getByTestId('book-next-from-progress').click();
    await expect(page.getByText('Book a Session')).toBeVisible();
    await expect(page.getByTestId('calendar-grid')).toBeVisible();
  });

  test('booking success → shows success screen', async ({ page }) => {
    await mountAsUser(page, S_ZACH);
    // portal-book returns {success: true} by default from mount-as-user
    await proceedToConfirm(page);
    await page.getByTestId('confirm-booking-btn').click();
    await expect(page.getByTestId('booking-success-screen')).toBeVisible();
    await expect(page.getByText("You're booked!")).toBeVisible();
  });

  test('booking error → shows error screen with message (reproduces red exclamation bug)', async ({ page }) => {
    await mountAsUser(page, S_ZACH);

    // Override portal-book to simulate the GHL error Zach was hitting
    await page.route('**/api/portal-book', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Booking failed (422): slot not available' }),
      })
    );

    await proceedToConfirm(page);
    await page.getByTestId('confirm-booking-btn').click();
    await expect(page.getByTestId('booking-error-screen')).toBeVisible();
    await expect(page.getByText('Something went wrong')).toBeVisible();
  });

  test('booking error → Try Again returns to calendar', async ({ page }) => {
    await mountAsUser(page, S_ZACH);

    await page.route('**/api/portal-book', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Booking failed (422): slot not available' }),
      })
    );

    await proceedToConfirm(page);
    await page.getByTestId('confirm-booking-btn').click();
    await expect(page.getByTestId('booking-error-screen')).toBeVisible();

    // Try Again should return to the date picker
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.getByTestId('calendar-grid')).toBeVisible();
    await expect(page.getByTestId('booking-error-screen')).not.toBeVisible();
  });

});
