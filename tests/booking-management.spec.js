import { test, expect } from '@playwright/test';

const BASE_URL      = process.env.BASE_URL ?? 'https://eventhub.rahulshettyacademy.com';
const USER_EMAIL    = 'rahulshetty1@gmail.com';
const USER_PASSWORD = 'Magiclife1!';

// en-IN short months include "Sept", so allow 3–4 letters
const SHORT_DATE = String.raw`\d{1,2} [A-Za-z]{3,4} \d{4}`;

// Same format the bookings pages use for prices
const fmtUsd = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

// ── Helpers ────────────────────────────────────────────────────────────────────

async function login(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder('you@email.com').fill(USER_EMAIL);
  await page.getByLabel('Password').fill(USER_PASSWORD);
  await page.locator('#login-btn').click();
  // Home page loads after login — "Browse Events →" link confirms successful auth
  await expect(page.getByRole('link', { name: 'Browse Events →' })).toBeVisible();
}

/**
 * Books 1 ticket for the first available (non-sold-out) event on the events page.
 * Leaves the page on the booking confirmation card.
 * Returns { bookingRef, event } where `event` is the API record (title, venue, city, category, price).
 * Precondition: user must be logged in before calling.
 */
async function bookEvent(page) {
  await page.goto(`${BASE_URL}/events`);

  // Pick the first card that has a visible "Book Now" button (not sold out)
  const firstCard = page.getByTestId('event-card').filter({
    has: page.getByTestId('book-now-btn'),
  }).first();
  await expect(firstCard).toBeVisible();

  // Capture the event record the detail page loads, to use as expected data
  const eventResponse = page.waitForResponse((res) =>
    res.request().method() === 'GET' && /\/api\/events\/\d+$/.test(new URL(res.url()).pathname));
  await firstCard.getByTestId('book-now-btn').click();
  await expect(page).toHaveURL(/\/events\/\d+/);
  const { data: event } = await (await eventResponse).json();
  console.log(`Booking event: "${event.title}"`);

  // Fill booking form
  await page.getByLabel('Full Name').fill('Test User');
  await page.locator('#customer-email').fill('testuser@example.com');
  await page.getByPlaceholder('+91 98765 43210').fill('9876543210');
  await page.locator('.confirm-booking-btn').click();

  // Wait for confirmation card
  const refEl = page.locator('.booking-ref').first();
  await expect(refEl).toBeVisible();
  const bookingRef = (await refEl.textContent())?.trim() ?? '';
  console.log(`Booking confirmed. Ref: ${bookingRef}`);
  return { bookingRef, event };
}

/**
 * Clears all bookings. Safe to call when already empty.
 */
async function clearBookings(page) {
  await page.goto(`${BASE_URL}/bookings`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /clear all bookings/i }).click();
  await expect(page.getByText('No bookings yet')).toBeVisible();
}

/** Returns the booking card on /bookings whose ref matches. */
function bookingCardByRef(page, bookingRef) {
  return page.getByTestId('booking-card').filter({
    has: page.locator('.booking-ref', { hasText: bookingRef }),
  });
}

// ── Test Suite ─────────────────────────────────────────────────────────────────

test.describe('Booking Management — Critical Happy Paths', () => {

  // TC-001 ───────────────────────────────────────────────────────────────────
  test('TC-001: displays booking card with all fields on bookings list page', async ({ page }) => {
    // -- Step 1: Login, clear state, create one booking --
    await login(page);
    await clearBookings(page);
    const { bookingRef, event } = await bookEvent(page);

    // -- Step 2: Navigate to /bookings --
    await page.goto(`${BASE_URL}/bookings`);

    // -- Step 3: Assert ref, status badge and booking id --
    const card = bookingCardByRef(page, bookingRef);
    await expect(card).toBeVisible();
    await expect(card.locator('.booking-ref')).toHaveText(bookingRef);
    await expect(card.getByText('confirmed', { exact: true })).toBeVisible();
    await expect(card.getByTestId('booking-id')).toHaveText(/^#\d+$/);

    // -- Step 4: Assert event title, date, ticket count, city, booked date, price --
    await expect(card.getByRole('heading', { name: event.title })).toBeVisible();
    await expect(card).toContainText(new RegExp(`📅 ${SHORT_DATE}`));
    await expect(card).toContainText('🎫 1 ticket');
    await expect(card).toContainText(`📍 ${event.city}`);
    await expect(card).toContainText(new RegExp(`🗓 Booked ${SHORT_DATE}`));
    await expect(card).toContainText(`${fmtUsd(event.price)}total`);

    // -- Step 5: Assert action buttons --
    await expect(card.getByRole('link', { name: 'View Details' })).toBeVisible();
    await expect(card.getByTestId('cancel-booking-btn')).toBeVisible();
  });

  // TC-002 ───────────────────────────────────────────────────────────────────
  test('TC-002: shows all sections on booking detail page', async ({ page }) => {
    // -- Step 1: Login, clear state, create one booking --
    await login(page);
    await clearBookings(page);
    const { bookingRef, event } = await bookEvent(page);

    // -- Step 2: Navigate to /bookings, capture booking id, click View Details --
    await page.goto(`${BASE_URL}/bookings`);
    const card = bookingCardByRef(page, bookingRef);
    const bookingIdText = (await card.getByTestId('booking-id').textContent())?.trim() ?? '';
    const bookingId = bookingIdText.replace('#', '');
    await card.getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/bookings/${bookingId}`);

    // -- Step 3: Verify breadcrumb, header ref, status badge and title --
    const breadcrumb = page.getByRole('navigation').filter({ hasText: bookingRef });
    await expect(breadcrumb.getByRole('link', { name: 'My Bookings' })).toBeVisible();
    // Ref appears twice: breadcrumb + header
    await expect(page.getByText(bookingRef, { exact: true })).toHaveCount(2);
    await expect(page.getByText('confirmed', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);

    // -- Step 4: Verify Event Details section shows the event's values --
    await expect(page.getByRole('heading', { name: 'Event Details' })).toBeVisible();
    // Title appears twice: h1 + "Event" field
    await expect(page.getByText(event.title, { exact: true })).toHaveCount(2);
    await expect(page.getByText(event.category, { exact: true })).toBeVisible();
    const eventDate = new Date(event.eventDate).toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    await expect(page.getByText(eventDate, { exact: true })).toBeVisible();
    await expect(page.getByText(event.venue, { exact: true })).toBeVisible();
    await expect(page.getByText(event.city, { exact: true })).toBeVisible();

    // -- Step 5: Verify Customer Details section shows the booking form values --
    await expect(page.getByRole('heading', { name: 'Customer Details' })).toBeVisible();
    await expect(page.getByText('Test User', { exact: true })).toBeVisible();
    await expect(page.getByText('testuser@example.com', { exact: true })).toBeVisible();
    await expect(page.getByText('9876543210', { exact: true })).toBeVisible();

    // -- Step 6: Verify Payment Summary — total = price × 1 ticket --
    await expect(page.getByRole('heading', { name: 'Payment Summary' })).toBeVisible();
    await expect(page.getByText('Tickets', { exact: true })).toBeVisible();
    await expect(page.getByText('Total Paid', { exact: true })).toBeVisible();
    // Price appears twice: "Price per ticket" + "Total Paid"
    await expect(page.getByText(fmtUsd(event.price), { exact: true })).toHaveCount(2);

    // -- Step 7: Verify Refund section --
    await expect(page.getByRole('heading', { name: 'Refund', exact: true })).toBeVisible();
    await expect(page.getByTestId('check-refund-btn')).toBeVisible();

    // -- Step 8: Verify Booking Information section --
    await expect(page.getByRole('heading', { name: 'Booking Information' })).toBeVisible();
    await expect(page.getByText('Booked on', { exact: true })).toBeVisible();
    await expect(page.getByText(`#${bookingId}`, { exact: true })).toBeVisible();
  });

  // TC-003 ───────────────────────────────────────────────────────────────────
  test('TC-003: cancels booking from detail page — shows toast and redirects', async ({ page }) => {
    // -- Step 1: Login, clear state, create one booking --
    await login(page);
    await clearBookings(page);
    const { bookingRef } = await bookEvent(page);

    // -- Step 2: Open the booking detail page via View Details --
    await page.goto(`${BASE_URL}/bookings`);
    await bookingCardByRef(page, bookingRef).getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(/\/bookings\/\d+$/);

    // -- Step 3: Click Cancel Booking and check the confirmation dialog --
    await page.getByRole('button', { name: 'Cancel Booking' }).click();
    await expect(page.getByText('Cancel this booking?')).toBeVisible();
    await expect(page.getByText(`Cancelling ${bookingRef} will release`)).toBeVisible();

    // -- Step 4: Confirm cancellation --
    await page.getByTestId('confirm-dialog-yes').click();

    // -- Step 5: Assert success toast and redirect to /bookings --
    await expect(page.getByText('Booking cancelled successfully')).toBeVisible();
    await expect(page).toHaveURL(`${BASE_URL}/bookings`);

    // -- Step 6: Assert the cancelled booking is no longer listed --
    await expect(page.getByText('No bookings yet')).toBeVisible();
    await expect(page.locator('.booking-ref', { hasText: bookingRef })).toHaveCount(0);
  });

  // TC-004 ───────────────────────────────────────────────────────────────────
  test('TC-004: clears all bookings and shows empty state', async ({ page }) => {
    // -- Step 1: Login, clear state, create one booking --
    await login(page);
    await clearBookings(page);
    await bookEvent(page);

    // -- Step 2: Navigate to /bookings and verify booking exists --
    await page.goto(`${BASE_URL}/bookings`);
    await expect(page.getByTestId('booking-card').first()).toBeVisible();

    // -- Step 3: Click "Clear all bookings" and accept browser confirm dialog --
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /clear all bookings/i }).click();

    // -- Step 4: Assert empty state --
    await expect(page.getByText('No bookings yet')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Browse Events' })).toBeVisible();
  });

  // TC-006 ───────────────────────────────────────────────────────────────────
  test('TC-006: navigates to bookings list after booking via View My Bookings link', async ({ page }) => {
    // -- Step 1: Login and clear state --
    await login(page);
    await clearBookings(page);

    // -- Step 2: Book the first available event (stays on confirmation card) --
    const { bookingRef } = await bookEvent(page);

    // -- Step 3: Click "View My Bookings" link on confirmation card --
    await page.getByRole('link', { name: 'View My Bookings' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/bookings`);

    // -- Step 4: Assert the new booking appears in the list --
    await expect(bookingCardByRef(page, bookingRef)).toBeVisible();
  });

  // TC-102 ───────────────────────────────────────────────────────────────────
  test('TC-102: booking reference starts with first letter of event title (uppercase)', async ({ page }) => {
    // -- Step 1: Login and clear state --
    await login(page);
    await clearBookings(page);

    // -- Step 2: Book first available event and capture title --
    const { bookingRef, event } = await bookEvent(page);

    // -- Step 3: Assert ref starts with the event title's first char --
    const expectedPrefix = event.title[0].toUpperCase();
    expect(bookingRef).toMatch(new RegExp(`^${expectedPrefix}-[A-Z0-9]{6}$`));
    console.log(`Ref "${bookingRef}" correctly starts with "${expectedPrefix}-" (event: "${event.title}")`);
  });

});
