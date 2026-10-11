# EventHub — Booking Management Test Scenarios

Generated: 2026-10-11
Scope: Booking Management (Flow 4: view, cancel, clear all, refund eligibility), plus the booking-creation and event rules that change what a user sees in their bookings (seats, FIFO pruning, cascades, sandbox isolation).

Sources: `eventhub-domain` skill (`business-rules.md`, `user-flows.md`), `frontend/app/bookings/**`, `frontend/app/admin/bookings/page.tsx`, `frontend/components/bookings/BookingCard.jsx`, `frontend/lib/hooks/useBookings.ts`, `backend/src/services/bookingService.js`, `backend/src/repositories/bookingRepository.js`, `backend/src/validators/bookingValidator.js`.

## Code vs documentation discrepancies

These scenarios follow the code. Where the code and the domain docs disagree, the scenario says which one it follows.

| # | Domain docs say | Code does | Scenarios |
|---|---|---|---|
| D1 | Cross-user booking access returns 403 | `GET /bookings/:id` and `GET /bookings/ref/:ref` return 403, but `DELETE /bookings/:id` returns **404** because `findById(id, userId)` filters by owner | TC-201, TC-202 |
| D2 | Static events have a fixed `availableSeats` | `withPersonalSeats` subtracts the user's own booked quantity for **all** events, static ones included | TC-109, TC-110 |
| D3 | Bookings page shows a sandbox-limit banner | No banner exists on `/bookings`; only `/events` has one (shown when more than 5 events are on the page) | TC-514 |
| D4 | Bookings page shows 9 per page | The page requests `limit: 10`; with a 9-booking cap, pagination can never appear on `/bookings` | TC-412 |
| D5 | Cancellation sets status to cancelled | Cancellation hard-deletes the row, so `status` is always `confirmed` and the admin "Cancelled" filter is always empty | TC-411 |
| D6 | (not documented) | In the FIFO same-event fallback, the **shared** `Event.availableSeats` is decremented by the **new** booking's quantity, which affects every user for static events | TC-101, TC-207 |

---

## Happy Path

### TC-001: View bookings list with existing bookings
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User is logged in and has at least one booking
**Steps**:
1. Navigate to `/bookings`
2. Observe the booking cards
**Expected Results**: Each `booking-card` shows the booking ref, a "confirmed" badge, `#<id>` (`booking-id`), event title, event date, ticket count, city, booked date, total price, a "View Details" button and a "Cancel Booking" button
**Business Rule**: Flow 4: Manage Bookings
**Suggested Layer**: E2E

---

### TC-002: View booking detail page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User is logged in and has at least one booking
**Steps**:
1. Navigate to `/bookings`
2. Click "View Details" on a booking card
**Expected Results**: URL is `/bookings/:id`. Page shows the breadcrumb, booking ref, status badge, event title, and sections for Event Details (event, category, date, venue, city), Customer Details (name, email, phone), Payment Summary (tickets, price per ticket, Total Paid), Refund, and Booking Information (booked on, booking ID)
**Business Rule**: Flow 4: View Details goes to `/bookings/:id`
**Suggested Layer**: E2E

---

### TC-003: Cancel a booking from the detail page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User is logged in and has a booking
**Steps**:
1. Open `/bookings/:id`
2. Click "Cancel Booking"
3. Click "Yes, cancel it" (`confirm-dialog-yes`) in the dialog
**Expected Results**: Toast "Booking cancelled successfully" appears, the browser goes to `/bookings`, and the cancelled booking is no longer listed
**Business Rule**: User can cancel individual bookings
**Suggested Layer**: E2E

---

### TC-004: Cancel a booking from the list card
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User is logged in and has at least two bookings
**Steps**:
1. Navigate to `/bookings`
2. Click `cancel-booking-btn` on one card
3. Click "Yes, cancel it" in the dialog
**Expected Results**: Toast "Booking cancelled successfully" appears, the browser stays on `/bookings`, that card disappears, and the other bookings remain
**Business Rule**: User can cancel individual bookings (BookingCard flow)
**Suggested Layer**: E2E

---

### TC-005: Clear all bookings
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User is logged in and has two or more bookings
**Steps**:
1. Navigate to `/bookings`
2. Register a dialog handler that accepts the native `confirm()` ("Clear all your bookings? This cannot be undone.")
3. Click "Clear all bookings"
**Expected Results**: All booking cards disappear and the "No bookings yet" empty state appears. `DELETE /api/bookings` responds 200 with `message: "<n> booking(s) cleared"`
**Business Rule**: "Clear All Bookings" removes all bookings in one action
**Suggested Layer**: E2E
**Note**: The page uses the browser's native `confirm()`. Playwright dismisses native dialogs by default, so the test must accept the dialog explicitly.

---

### TC-006: Go back to the bookings list from the detail page
**Category**: Happy Path
**Priority**: P2
**Preconditions**: User is on `/bookings/:id`
**Steps**:
1. Click "← Back to My Bookings"
2. Open the detail page again and click the "My Bookings" breadcrumb link
**Expected Results**: Both links go to `/bookings`
**Business Rule**: Flow 4 navigation
**Suggested Layer**: E2E

---

### TC-007: "View My Bookings" after booking shows the new booking
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User is logged in
**Steps**:
1. Book any event from `/events/:id`
2. On the confirmation card, note the `booking-ref`
3. Click "View My Bookings"
**Expected Results**: The browser goes to `/bookings` and the first (newest) card shows the same booking ref
**Business Rule**: After booking, the user can view bookings via "View My Bookings"
**Suggested Layer**: E2E

---

### TC-008: Look up a booking by reference
**Category**: Happy Path
**Priority**: P2
**Preconditions**: User owns a booking with a known `bookingRef`
**Steps**:
1. `GET /api/bookings/ref/<bookingRef>` with the user's token
**Expected Results**: 200; `data.bookingRef` matches and `data.event` is included
**Business Rule**: API: GET `/api/bookings/ref/:ref`
**Suggested Layer**: API

---

### TC-009: Admin Bookings page lists the user's bookings and shows the View modal
**Category**: Happy Path
**Priority**: P2
**Preconditions**: User is logged in and has a booking
**Steps**:
1. Navigate to `/admin/bookings`
2. Click "View" on a row
**Expected Results**: The table shows the ref, customer name and email, event, tickets, total, status and booked date. The modal is titled "Booking — <ref>" and shows the same data. Only the current user's bookings appear, because the page uses the same user-scoped `/api/bookings` endpoint.
**Business Rule**: Sandbox isolation applies to admin pages too
**Suggested Layer**: E2E

---

## Business Rules

### TC-100: FIFO pruning: a 10th booking replaces the oldest booking for a different event
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User has exactly 9 bookings; the oldest one is for event A
**Steps**:
1. Book event B (B ≠ A)
2. `GET /api/bookings?limit=20`
**Expected Results**: Total is still 9. The oldest booking (event A) is gone and the new booking for B exists
**Business Rule**: Max 9 bookings per user; FIFO pruning prefers a booking for a different event
**Suggested Layer**: API

---

### TC-101: FIFO same-event fallback burns shared seats by the new booking's quantity
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User has 9 bookings, all for event E. Record the raw `availableSeats` S0 and the user's booked total Q
**Steps**:
1. Book event E with quantity q
2. `GET /api/events/E`
**Expected Results** (current code behavior): The oldest booking (quantity q_old) is deleted and the stored `availableSeats` becomes S0 − q. The user now sees `S0 − q − (Q − q_old + q)` seats, so the new booking's seats are subtracted twice: once from the stored value and once as a personal booking
**Business Rule**: `bookingService.createBooking`, `sameEventFallback` branch (D6)
**Suggested Layer**: API / Unit

---

### TC-102: Booking ref starts with the event title's first character, uppercased
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User is logged in
**Steps**:
1. Book a static event (e.g. "Tech Conference Bangalore")
2. Create an event titled "zebra show" and book it
**Expected Results**: Refs match `^T-[A-Z0-9]{6}$` and `^Z-[A-Z0-9]{6}$`. The ref is the same on the confirmation card, the list card and the detail page
**Business Rule**: Booking ref first character = event title first character (uppercase)
**Suggested Layer**: E2E (one case) + Unit (`randomRef`)

---

### TC-103: Refund eligibility: a 1-ticket booking is eligible
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User has a booking with quantity 1
**Steps**:
1. Open `/bookings/:id`
2. Click `check-refund-btn`
**Expected Results**: `refund-spinner` is visible, then `refund-result` shows "Eligible for refund. Single-ticket bookings qualify for a full refund."
**Business Rule**: 1 ticket = eligible (client-side)
**Suggested Layer**: E2E

---

### TC-104: Refund eligibility: a multi-ticket booking is not eligible
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User has a booking with quantity 3
**Steps**:
1. Open `/bookings/:id`
2. Click `check-refund-btn`
**Expected Results**: `refund-result` shows "Not eligible for refund. Group bookings (3 tickets) are non-refundable."
**Business Rule**: More than 1 ticket = not eligible
**Suggested Layer**: E2E

---

### TC-105: Refund check shows a spinner for about 4 seconds
**Category**: Business Rule
**Priority**: P2
**Preconditions**: User is on a booking detail page
**Steps**:
1. Click `check-refund-btn`
2. Assert that `refund-spinner` is visible immediately
3. Assert that `refund-result` becomes visible (expect timeout above 4s, e.g. 6s)
**Expected Results**: The spinner shows "Checking your refund eligibility…" and the result replaces it after the 4000 ms timer
**Business Rule**: 4-second spinner before the result
**Suggested Layer**: Component (fake timers); E2E only with a longer expect timeout, never `waitForTimeout`

---

### TC-106: Total price = event price × quantity
**Category**: Business Rule
**Priority**: P0
**Preconditions**: A known event price P (e.g. Marathon Chennai, $49)
**Steps**:
1. Book with quantity 3
2. Check the confirmation card, the list card and the detail page "Total Paid"
**Expected Results**: Every view shows $147 (formatted USD with no decimals). The API's `totalPrice` is 147.00
**Business Rule**: `totalPrice = event.price × quantity`
**Suggested Layer**: API + E2E

---

### TC-107: Bookings list is sorted newest first
**Category**: Business Rule
**Priority**: P2
**Preconditions**: User creates bookings for events X, then Y, then Z
**Steps**:
1. Navigate to `/bookings`
**Expected Results**: Card order is Z, Y, X
**Business Rule**: `bookingRepository.findAll` orders by `createdAt desc`
**Suggested Layer**: API

---

### TC-108: Cancelling restores seats on a user-created event
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User created an event with 50 seats
**Steps**:
1. Book 4 tickets and confirm the event shows 46 available
2. Cancel the booking
3. Reload the event detail page
**Expected Results**: Available seats are back to 50
**Business Rule**: Seat count is restored on cancellation (computed per user)
**Suggested Layer**: E2E

---

### TC-109: Cancelling restores seats on a static event
**Category**: Business Rule
**Priority**: P1
**Preconditions**: Note the available seats S of static event "Photography Workshop"
**Steps**:
1. Book 2 tickets; the event shows S − 2
2. Cancel the booking
**Expected Results**: The event shows S again. The shared `availableSeats` value in the database is unchanged throughout
**Business Rule**: Per-user seat computation applies to static events too (D2)
**Suggested Layer**: API

---

### TC-110: Seat reduction is per user and not visible to other users
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User A and User B both see S seats on static event E
**Steps**:
1. User A books 5 tickets for E
2. User A and User B each `GET /api/events/E`
**Expected Results**: User A sees S − 5 and User B still sees S
**Business Rule**: Sandbox isolation; `withPersonalSeats` (D2)
**Suggested Layer**: API

---

### TC-111: Clear all restores seats on every affected event
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User has bookings on events E1 (qty 2) and E2 (qty 3)
**Steps**:
1. Clear all bookings
2. `GET /api/events/E1` and `GET /api/events/E2`
**Expected Results**: Both events show their pre-booking seat counts
**Business Rule**: Clearing deletes bookings, so the computed seats return
**Suggested Layer**: API

---

### TC-112: Deleting an event cascades to its bookings
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User created event D and has a booking on D
**Steps**:
1. Delete D from `/admin/events`
2. Navigate to `/bookings`
3. Navigate to the old `/bookings/:id`
**Expected Results**: The booking is gone from the list and the detail page shows "Booking not found"
**Business Rule**: Booking `onDelete: Cascade` with Event
**Suggested Layer**: E2E

---

### TC-113: FIFO pruning of a 7th event removes bookings on the pruned event
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User has 6 created events; the oldest (O) has a booking
**Steps**:
1. Create a 7th event
2. `GET /api/bookings`
**Expected Results**: Event O is deleted and its booking no longer appears
**Business Rule**: Max 6 events with FIFO pruning, plus cascade delete
**Suggested Layer**: API

---

### TC-114: The same user can book the same event several times
**Category**: Business Rule
**Priority**: P2
**Preconditions**: User is logged in
**Steps**:
1. Book event E with quantity 2
2. Book event E again with quantity 3
**Expected Results**: Two separate bookings with different refs, both starting with E's first letter. The event shows S − 5
**Business Rule**: "Allows the same user to book the same event multiple times for testing"
**Suggested Layer**: API

---

## Security

### TC-200: Viewing another user's booking shows "Access Denied"
**Category**: Security
**Priority**: P0
**Preconditions**: User A owns booking #X
**Steps**:
1. Log in as User B (`rahulshetty1@yahoo.com`)
2. Navigate to `/bookings/X`
**Expected Results**: Empty state titled "Access Denied" with "You are not authorized to view this booking." No booking data is rendered
**Business Rule**: Cross-user booking access returns "Access Denied"
**Suggested Layer**: E2E

---

### TC-201: Fetching another user's booking via the API returns 403
**Category**: Security
**Priority**: P0
**Preconditions**: User A owns booking #X
**Steps**:
1. `GET /api/bookings/X` with User B's token
2. `GET /api/bookings/ref/<X's ref>` with User B's token
**Expected Results**: Both return 403, `success: false`, and no booking fields in the body
**Business Rule**: `getBookingById` / `getBookingByRef` throw `ForbiddenError`
**Suggested Layer**: API

---

### TC-202: Cancelling another user's booking fails and leaves it intact
**Category**: Security
**Priority**: P0
**Preconditions**: User A owns booking #X
**Steps**:
1. `DELETE /api/bookings/X` with User B's token
2. `GET /api/bookings/X` with User A's token
**Expected Results**: Step 1 returns **404** "Booking with id X not found" (not 403, see D1). Step 2 returns 200 and the booking still exists
**Business Rule**: Ownership is enforced on cancel; the status code differs from GET
**Suggested Layer**: API

---

### TC-203: Booking endpoints require a token
**Category**: Security
**Priority**: P0
**Preconditions**: None
**Steps**:
1. Without an `Authorization` header, call `GET /api/bookings`, `GET /api/bookings/1`, `GET /api/bookings/ref/T-AAAAAA`, `POST /api/bookings`, `DELETE /api/bookings/1` and `DELETE /api/bookings`
**Expected Results**: All return 401 `{ success: false, error: "Unauthorized" }`
**Business Rule**: `router.use(authMiddleware)` on booking routes
**Suggested Layer**: API

---

### TC-204: Invalid or expired token returns 401 and the UI goes to the login page
**Category**: Security
**Priority**: P1
**Preconditions**: User is logged in
**Steps**:
1. Set `localStorage.eventhub_token` to a tampered value
2. Navigate to `/bookings`
**Expected Results**: The API returns 401 "Invalid or expired token". The Axios interceptor removes the token and redirects to `/login`
**Business Rule**: JWT verification; client 401 handling
**Suggested Layer**: E2E

---

### TC-205: Unauthenticated visit to /bookings redirects to the login page
**Category**: Security
**Priority**: P1
**Preconditions**: No token in localStorage
**Steps**:
1. Navigate to `/bookings` and to `/bookings/1`
**Expected Results**: The browser ends up on `/login` and no booking data is shown
**Business Rule**: `AuthGuard` sends non-public paths to `/login`
**Suggested Layer**: E2E

---

### TC-206: Clear all only deletes the caller's bookings
**Category**: Security
**Priority**: P0
**Preconditions**: User A and User B each have bookings
**Steps**:
1. `DELETE /api/bookings` as User B
2. `GET /api/bookings` as User A
**Expected Results**: User A's bookings are unchanged
**Business Rule**: `deleteAllForUser(userId)`
**Suggested Layer**: API

---

### TC-207: FIFO same-event fallback on a static event changes seats for other users
**Category**: Security
**Priority**: P1
**Preconditions**: User A has 9 bookings, all for static event E. User B sees S seats on E
**Steps**:
1. User A books E again (quantity q)
2. User B `GET /api/events/E`
**Expected Results** (current code behavior): User B now sees S − q, so one user's action has changed another user's sandbox. Report this as a sandbox-isolation defect
**Business Rule**: Sandbox isolation vs `eventRepository.decrementSeats` in the fallback (D6)
**Suggested Layer**: API

---

### TC-208: Booking another user's event returns 404
**Category**: Security
**Priority**: P1
**Preconditions**: User A created event #E (dynamic)
**Steps**:
1. `POST /api/bookings` with `eventId: E` and User B's token
**Expected Results**: 404 "Event with id E not found" and no booking is created
**Business Rule**: `eventRepository.findById` filters to static events or the user's own events
**Suggested Layer**: API

---

### TC-209: The bookings list cannot be widened with query parameters
**Category**: Security
**Priority**: P2
**Preconditions**: User A and User B have bookings
**Steps**:
1. As User B, `GET /api/bookings?userId=<A's id>&limit=100`
**Expected Results**: Only User B's bookings are returned; `userId` is ignored
**Business Rule**: `where = { userId }` comes from the JWT
**Suggested Layer**: API

---

## Negative

### TC-300: A non-existent booking ID shows "Booking not found"
**Category**: Negative
**Priority**: P1
**Preconditions**: User is logged in
**Steps**:
1. Navigate to `/bookings/99999999`
**Expected Results**: Empty state "Booking not found" with a "View My Bookings" button. The API returns 404
**Business Rule**: `NotFoundError` → 404; the UI tells 404 apart from 403
**Suggested Layer**: E2E

---

### TC-301: A non-numeric booking ID is handled
**Category**: Negative
**Priority**: P2
**Preconditions**: User is logged in
**Steps**:
1. `GET /api/bookings/abc` and `DELETE /api/bookings/abc`
2. Navigate to `/bookings/abc`
**Expected Results**: The API returns a 4xx error (there is no ID validator, and `Number('abc')` is NaN, so the API may return 500; record the actual code as a finding). The UI shows "Booking not found" and does not crash
**Business Rule**: Discovered: no param validation on `:id`
**Suggested Layer**: API

---

### TC-302: Cancelling a booking twice returns 404
**Category**: Negative
**Priority**: P1
**Preconditions**: User owns booking #X
**Steps**:
1. `DELETE /api/bookings/X`, which returns 200 with `bookingRef`
2. `DELETE /api/bookings/X` again
**Expected Results**: The second call returns 404
**Business Rule**: Hard delete; `NotFoundError`
**Suggested Layer**: API

---

### TC-303: Unknown booking reference returns 404
**Category**: Negative
**Priority**: P2
**Steps**:
1. `GET /api/bookings/ref/Z-000000`
**Expected Results**: 404 `Booking with reference "Z-000000" not found`
**Business Rule**: `getBookingByRef`
**Suggested Layer**: API

---

### TC-304: Requesting more seats than are available returns 400
**Category**: Negative
**Priority**: P0
**Preconditions**: User created an event with 3 seats
**Steps**:
1. `POST /api/bookings` with quantity 4
**Expected Results**: 400 "Only 3 seat(s) available, but 4 requested" and no booking is created
**Business Rule**: `InsufficientSeatsError`
**Suggested Layer**: API

---

### TC-305: Booking a non-existent event returns 404
**Category**: Negative
**Priority**: P1
**Steps**:
1. `POST /api/bookings` with `eventId: 99999999` and a valid body
**Expected Results**: 404 "Event with id 99999999 not found"
**Business Rule**: `bookingService.createBooking`
**Suggested Layer**: API

---

### TC-306: Booking validation errors return field-level details
**Category**: Negative
**Priority**: P1
**Steps**: `POST /api/bookings` once per invalid body:
1. Missing `customerName`, `customerEmail`, `customerPhone` or `quantity`
2. `customerName: "A"`
3. `customerEmail: "not-an-email"`
4. `customerPhone: "12345"` (too short) and `"98765abcde"` (letters)
5. `quantity: 0`, `-1`, `11`, `2.5`
6. `eventId: 0` or `"abc"`
**Expected Results**: Each returns 400 `{ error: "Validation failed", details: [{ field, message }] }` with the matching message (e.g. "Quantity must be an integer between 1 and 10")
**Business Rule**: `bookingValidator.js`
**Suggested Layer**: API (data-driven)

---

### TC-307: Dismissing the "Clear all" confirm deletes nothing
**Category**: Negative
**Priority**: P1
**Preconditions**: User has bookings
**Steps**:
1. On `/bookings`, dismiss the native `confirm()` (Playwright's default)
2. Click "Clear all bookings"
**Expected Results**: No `DELETE /api/bookings` request is sent and all cards remain
**Business Rule**: `handleClearAll` returns early when `confirm` is false
**Suggested Layer**: E2E

---

### TC-308: "Clear all" failure gives no error feedback
**Category**: Negative
**Priority**: P2
**Preconditions**: Mock `DELETE /api/bookings` to return 500
**Steps**:
1. Accept the confirm and click "Clear all bookings"
**Expected Results** (current code behavior): The button returns to "Clear all bookings", no toast or error message appears, and the bookings remain. `handleClearAll` has `try/finally` but no `catch`, so there's an unhandled rejection. Report this as a UX defect
**Business Rule**: Discovered: `app/bookings/page.tsx` `handleClearAll`
**Suggested Layer**: E2E (route mock) / Component

---

### TC-309: Bookings page shows an error state when the API fails
**Category**: Negative
**Priority**: P2
**Preconditions**: Mock `GET /api/bookings` to fail
**Steps**:
1. Navigate to `/bookings`
2. Remove the mock and click "Retry"
**Expected Results**: "Couldn't load bookings" with a "Retry" button. After retry, the bookings load
**Business Rule**: `isError` branch in `BookingsContent`
**Suggested Layer**: E2E (route mock) / Component

---

### TC-310: Cancel failure shows an error toast and closes the dialog
**Category**: Negative
**Priority**: P2
**Preconditions**: Booking card visible; the booking was already deleted in another tab or via the API
**Steps**:
1. Click `cancel-booking-btn` and confirm
**Expected Results**: An error toast with "Booking with id X not found" appears and the dialog closes
**Business Rule**: `useCancelBooking` `onError` handler
**Suggested Layer**: E2E

---

## Edge Cases

### TC-400: Exactly 9 bookings: no pruning; the 10th triggers pruning
**Category**: Edge Case
**Priority**: P0
**Preconditions**: User has 0 bookings (clear all first)
**Steps**:
1. Create 9 bookings across different events and check the count is 9 with none pruned
2. Create a 10th
**Expected Results**: After 9 bookings, all 9 exist. After the 10th, the count is still 9 and the oldest is gone
**Business Rule**: `count >= MAX_USER_BOOKINGS` (9)
**Suggested Layer**: API

---

### TC-401: Booking exactly the remaining seats succeeds; one more fails
**Category**: Edge Case
**Priority**: P1
**Preconditions**: User created an event with 5 seats
**Steps**:
1. Book quantity 5
2. Book quantity 1
**Expected Results**: Step 1 succeeds and the event shows 0 seats. Step 2 returns 400 "Only 0 seat(s) available, but 1 requested"
**Business Rule**: `personalAvailable < quantity` check
**Suggested Layer**: API

---

### TC-402: Quantity boundaries 1 and 10
**Category**: Edge Case
**Priority**: P1
**Steps**:
1. Book with quantity 1
2. Book with quantity 10
**Expected Results**: Both succeed; totals are price × 1 and price × 10. The card shows "1 ticket" and "10 tickets"
**Business Rule**: Quantity 1–10
**Suggested Layer**: API

---

### TC-403: Refund boundary: quantity 2 is not eligible
**Category**: Edge Case
**Priority**: P1
**Steps**:
1. Book quantity 2 and run the refund check
**Expected Results**: "Not eligible for refund. Group bookings (2 tickets) are non-refundable."
**Business Rule**: `quantity === 1` is the only eligible value
**Suggested Layer**: Component / E2E

---

### TC-404: Event title starting with a digit or lowercase letter
**Category**: Edge Case
**Priority**: P2
**Steps**:
1. Create events titled "2026 Expo" and "éclair fest"; book each
**Expected Results**: Refs start with `2-` and `É-` (JavaScript `toUpperCase`)
**Business Rule**: `(eventTitle[0]).toUpperCase()`
**Suggested Layer**: Unit

---

### TC-405: Booking ref collision retry and fallback
**Category**: Edge Case
**Priority**: P3
**Steps**:
1. Unit-test `generateUniqueRef` with `findByRef` stubbed to always return a booking
**Expected Results**: After 10 attempts it returns `<PREFIX>-<base36 timestamp, up to 8 chars>`
**Business Rule**: Unique via collision retry
**Suggested Layer**: Unit

---

### TC-406: Clear all with zero bookings
**Category**: Edge Case
**Priority**: P2
**Preconditions**: User has no bookings
**Steps**:
1. `DELETE /api/bookings`
2. On `/bookings`, check that the "Clear all bookings" button is still visible next to the empty state
**Expected Results**: 200 with "0 booking(s) cleared". The button is always rendered, whether or not there are bookings
**Business Rule**: `clearAllBookings`
**Suggested Layer**: API

---

### TC-407: Customer email is normalized on save
**Category**: Edge Case
**Priority**: P2
**Steps**:
1. Book with `customerEmail: "First.Last+qa@Gmail.com"`
2. Open the booking detail page
**Expected Results** (current code behavior): The stored email is normalized by `normalizeEmail()` (lowercased, Gmail dots and `+` suffix removed: `firstlast@gmail.com`), so it differs from what was typed. Confirm this is intended
**Business Rule**: Discovered: `bookingValidator` `.normalizeEmail()`
**Suggested Layer**: API

---

### TC-408: Customer name with surrounding spaces is trimmed
**Category**: Edge Case
**Priority**: P3
**Steps**:
1. Book with `customerName: "  Al  "`, then with `"  A  "`
**Expected Results**: The first is stored as "Al". The second fails with "Customer name must be at least 2 characters" (trimmed before the length check)
**Business Rule**: `.trim()` before `isLength`
**Suggested Layer**: API

---

### TC-409: Phone number with allowed symbols
**Category**: Edge Case
**Priority**: P3
**Steps**:
1. Book with `customerPhone: "+91 (987) 654-3210"`
**Expected Results**: Accepted and shown unchanged on the detail page
**Business Rule**: Regex `^[0-9+\-\s()]+$` and minimum length 10
**Suggested Layer**: API

---

### TC-410: API pagination for bookings
**Category**: Edge Case
**Priority**: P2
**Preconditions**: User has 7 bookings
**Steps**:
1. `GET /api/bookings?page=2&limit=5`
2. `GET /api/bookings?page=5&limit=5`
**Expected Results**: Step 1 returns 2 items with `pagination: { total: 7, page: 2, limit: 5, totalPages: 2 }`. Step 2 returns an empty `data` with the same total
**Business Rule**: `bookingService.getBookings`
**Suggested Layer**: API

---

### TC-411: Admin "Cancelled" status filter is always empty
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User has cancelled at least one booking and still has others
**Steps**:
1. On `/admin/bookings`, choose the "Cancelled" filter
**Expected Results** (current code behavior): No rows, because cancelled bookings are deleted rather than kept with a cancelled status. Report this as a dead filter
**Business Rule**: Hard-delete cancellation (D5)
**Suggested Layer**: E2E

---

### TC-412: Bookings page pagination never appears in the UI
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User has 9 bookings (the maximum)
**Steps**:
1. Navigate to `/bookings`
**Expected Results**: 9 cards and a single page; `totalPages` is 1 (limit 10 > cap 9). Pagination UI can only be tested with a mocked response
**Business Rule**: Page `limit: 10` vs 9-booking cap (D4)
**Suggested Layer**: E2E

---

## UI State

### TC-500: Bookings list shows a skeleton while loading
**Category**: UI State
**Priority**: P3
**Steps**:
1. Delay `GET /api/bookings` with a route handler
2. Navigate to `/bookings`
**Expected Results**: 5 `BookingCardSkeleton` placeholders appear, then the real cards replace them
**Suggested Layer**: Component

---

### TC-501: Empty state when the user has no bookings
**Category**: UI State
**Priority**: P1
**Preconditions**: Clear all bookings first
**Steps**:
1. Navigate to `/bookings`
2. Click "Browse Events"
**Expected Results**: "No bookings yet" with the text "You haven't booked any events yet…". The button goes to `/events`
**Suggested Layer**: E2E

---

### TC-502: Detail page shows a spinner while loading
**Category**: UI State
**Priority**: P3
**Steps**:
1. Delay `GET /api/bookings/:id` and open `/bookings/:id`
**Expected Results**: A centered large spinner, then the detail content
**Suggested Layer**: Component

---

### TC-503: Cancel dialog content (list card and detail page)
**Category**: UI State
**Priority**: P1
**Steps**:
1. Click "Cancel Booking" on a card with ref R and quantity Q
2. Do the same on the detail page
**Expected Results**: Title "Cancel this booking?". Card text: "This will cancel R and release Q seat(s) back to the event. This action cannot be undone." Detail text: "Cancelling R will release Q seat(s) back to the event. This cannot be undone." Confirm button label "Yes, cancel it"
**Suggested Layer**: E2E

---

### TC-504: Closing the cancel dialog does not cancel
**Category**: UI State
**Priority**: P1
**Steps**:
1. Open the cancel dialog
2. Close it with the cancel button, then reopen and close with the Escape key
**Expected Results**: No `DELETE` request is sent and the booking still exists
**Suggested Layer**: E2E

---

### TC-505: Breadcrumb shows the booking ref
**Category**: UI State
**Priority**: P3
**Steps**:
1. Open `/bookings/:id`
**Expected Results**: The breadcrumb reads "My Bookings / <bookingRef>"
**Suggested Layer**: E2E

---

### TC-506: "Clear all bookings" shows "Clearing…" while in progress
**Category**: UI State
**Priority**: P3
**Steps**:
1. Delay `DELETE /api/bookings`, accept the confirm and click the button
**Expected Results**: The button text is "Clearing…" and it is disabled until the request finishes
**Suggested Layer**: Component / E2E (route mock)

---

### TC-507: Refund state changes from idle to checking to result
**Category**: UI State
**Priority**: P2
**Steps**:
1. Click `check-refund-btn`
**Expected Results**: The button disappears and the spinner appears. After 4s, `refund-result` appears and the button doesn't return
**Suggested Layer**: Component

---

### TC-508: Refund result resets on reload
**Category**: UI State
**Priority**: P3
**Steps**:
1. Complete a refund check, then reload the page
**Expected Results**: The idle `check-refund-btn` is shown again (state is client-only and not saved)
**Suggested Layer**: E2E

---

### TC-509: 403 shows "Access Denied" and other errors show "Booking not found"
**Category**: UI State
**Priority**: P0
**Steps**:
1. Mock `GET /api/bookings/:id` to return 403, then 404, then 500
**Expected Results**: 403 shows "Access Denied" / "You are not authorized to view this booking." 404 and 500 show "Booking not found". All three have a "View My Bookings" button
**Business Rule**: `is403` check in the detail page
**Suggested Layer**: Component / E2E (route mock)

---

### TC-510: Ticket count is pluralized on the card
**Category**: UI State
**Priority**: P3
**Steps**:
1. View cards for bookings with quantity 1 and quantity 2
**Expected Results**: "🎫 1 ticket" and "🎫 2 tickets"
**Suggested Layer**: Component

---

### TC-511: Event seat counts after "Clear all" may be stale
**Category**: UI State
**Priority**: P2
**Preconditions**: User booked 3 tickets for event E and has seen E's seat count on `/events` (cached)
**Steps**:
1. Clear all bookings on `/bookings`
2. Go to `/events` using client-side navigation (navbar), without reloading
**Expected Results**: The seat count for E should be back to the original value. Risk: `handleClearAll` only calls `refetch()` for bookings and doesn't invalidate the `['events']` query, unlike `useCancelBooking`. Report as a defect if the count is stale
**Business Rule**: Seats restore on cancellation; React Query cache invalidation
**Suggested Layer**: E2E

---

### TC-512: Status badge on list, detail and admin pages
**Category**: UI State
**Priority**: P3
**Steps**:
1. View a booking on `/bookings`, `/bookings/:id` and `/admin/bookings`
**Expected Results**: A green "confirmed" badge everywhere, and "Cancel" buttons are shown only for confirmed bookings
**Suggested Layer**: Component

---

### TC-513: Navbar "My Bookings" link
**Category**: UI State
**Priority**: P3
**Steps**:
1. From `/events`, click `nav-bookings`
**Expected Results**: The browser goes to `/bookings` and the link shows as active
**Suggested Layer**: E2E

---

### TC-514: No sandbox-limit banner on the bookings page
**Category**: UI State
**Priority**: P3
**Preconditions**: User has 9 bookings
**Steps**:
1. Navigate to `/bookings`
**Expected Results** (current code behavior): No limit banner is shown. `business-rules.md` §5 says one should appear (D3); confirm which is correct
**Business Rule**: Sandbox Warning Banners
**Suggested Layer**: E2E

---

## Summary

| Category | Count | IDs |
|---|---|---|
| Happy Path | 9 | TC-001 – TC-009 |
| Business Rule | 15 | TC-100 – TC-114 |
| Security | 10 | TC-200 – TC-209 |
| Negative | 11 | TC-300 – TC-310 |
| Edge Case | 13 | TC-400 – TC-412 |
| UI State | 15 | TC-500 – TC-514 |
| **Total** | **73** | |

**Likely defects to confirm**: TC-101 / TC-207 (same-event fallback double-counts seats and leaks across users), TC-202 (403 vs 404 inconsistency), TC-301 (non-numeric ID), TC-308 (silent clear-all failure), TC-411 (dead "Cancelled" filter), TC-511 (stale event cache after clear all), TC-514 (missing banner).
