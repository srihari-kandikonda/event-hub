# EventHub — Booking Management Test Strategy

Generated: 2026-10-11
Input: `docs/test-scenarios.md` (73 scenarios, TC-001 – TC-514, generated 2026-10-11)
Consumed by: `/generate-tests`

---

## 1. Distribution

Every scenario has one **primary** layer. Critical rules also get **secondary** layers for defense in depth (see §5), so there are more implementations than scenarios.

| Layer | Primary | + Secondary | Implementations | Focus | Approx. run time |
|---|---|---|---|---|---|
| **Unit** | 4 | 3 | 7 | Booking-ref generation, price formula, FIFO victim selection, fallback seat math | < 1 s |
| **API / Integration** | 34 | 2 | 36 | Endpoint contracts, auth/ownership, validation, seat computation, FIFO, cascades | 20–40 s |
| **Component** | 25 | 0 | 25 | Loading, empty, error, dialog, refund and pagination states on a single page with a mocked API | 15–30 s |
| **E2E** | 10 | 3 | 13 | Critical journeys, two-user security, token handling, cross-page cache | 2–4 min |
| **Total** | **73** | **8** | **81** | | |

**Shape:** the base is narrower than an ideal pyramid. Unit has 7 implementations and API has 36, so the overall shape is closer to a diamond. That is a property of the code, not a choice:
- Almost every booking rule is a Prisma query in `bookingService.js` or `bookingRepository.js` (seat sums via `groupBy`, FIFO via `findFirst orderBy createdAt`, ownership via `where: { userId }`). Mocking Prisma to unit-test these would test the mocks. The real rule only exists when it runs against the database.
- The pure helpers (`randomRef`, `generateUniqueRef`) are module-private. They have to be exported before they can be unit-tested (§7).

E2E stays the narrowest layer (13 of 81), so this is not an ice-cream cone.

---

## 2. Tooling (read before generating tests)

The repo only has `@playwright/test` installed; there is no Jest, Vitest or Supertest. Each layer maps to a runner like this:

| Layer | Runner | Location | Notes |
|---|---|---|---|
| Unit | `node --test` (built into Node 18+, no new dependency) | `backend/test/*.test.js` | Needs the helpers in `bookingService.js` to be exported (§7) |
| API | Playwright `request` fixture | `tests/booking-management-api.spec.js` | Base URL comes from an `API_URL` env var (default `http://localhost:3001/api`). Get the token via `POST /api/auth/login` or `/register`; no browser needed |
| Component | Playwright page tests with `page.route()` mocks | `tests/booking-management-ui.spec.js` | No component runner exists. One page plus mocked API isolates the UI from the backend, which is the intent of the Component layer. Move these to Vitest + React Testing Library if one is added later |
| E2E | Playwright with the real frontend and backend | `tests/booking-management.spec.js` (existing) | Keep it small |

**Environment caveat:** `playwright.config.ts` `baseURL` is the public deployed site, and the shared test account (`rahulshetty1@gmail.com`) is published for everyone. Any trainee running tests changes that account's bookings at the same time. Therefore:
- Count-sensitive API tests (TC-100, TC-400, TC-410, TC-406, TC-111) **must register a fresh user** per test (`POST /api/auth/register` with `qa+<timestamp>@example.com`). The sandbox model gives each user isolated data.
- Seat tests (TC-108, TC-109, TC-401, TC-304) should **create their own event** with a known seat count instead of relying on seeded event IDs, which differ between environments.
- The two-user tests (TC-200, TC-201, TC-202, TC-206 – TC-209) should use two fresh users, not the shared Gmail and Yahoo accounts.

---

## 3. Layer Assignments

### 3.1 Unit (primary: 4, secondary: 3)
Source: `backend/src/services/bookingService.js`

| TC | Title | Function under test | Location | Role |
|---|---|---|---|---|
| TC-102 | Ref prefix = first title character, uppercased | `randomRef(eventTitle)` | `bookingService.js:11` | Primary |
| TC-404 | Title starts with a digit or accented lowercase letter | `randomRef('2026 Expo')`, `randomRef('éclair fest')` | `bookingService.js:11` | Primary |
| TC-405 | Collision retry and timestamp fallback after 10 attempts | `generateUniqueRef` with stubbed `bookingRepository.findByRef` | `bookingService.js:21` | Primary |
| TC-106 | `totalPrice = price × quantity` (decimal string price) | `bookingService.createBooking` with stubbed repositories | `bookingService.js:99` | Primary |
| TC-100 | FIFO picks the oldest booking for a *different* event first | `createBooking`: `findOldestUserBookingExcludingEvent ?? findOldestUserBooking` | `bookingService.js:73` | Secondary |
| TC-400 | Pruning triggers at `count >= 9` and not at 8 | `createBooking` with `countUserBookings` stubbed to 8 and 9 | `bookingService.js:72` | Secondary |
| TC-101 | Fallback calls `decrementSeats(eventId, newQuantity)`, using the new quantity, not the pruned one | `createBooking` with a spy on `eventRepository.decrementSeats` | `bookingService.js:95` | Secondary |

`require` caches modules, so stubbing works by replacing methods on the repository objects before the call. No DB is needed.

### 3.2 API / Integration (primary: 34, secondary: 2)
Sources: `backend/src/routes/bookingRoutes.js`, `controllers/bookingController.js`, `services/bookingService.js`, `validators/bookingValidator.js`, `middleware/authMiddleware.js`, `middleware/errorHandler.js`

#### Contracts and reads
| TC | Title | Endpoint | Service / code |
|---|---|---|---|
| TC-008 | Look up booking by ref | `GET /bookings/ref/:ref` | `getBookingByRef` |
| TC-107 | List sorted newest first | `GET /bookings` | `bookingRepository.findAll` `orderBy createdAt desc` |
| TC-410 | Pagination shape and out-of-range page | `GET /bookings?page&limit` | `getBookings` → `{ total, page, limit, totalPages }` |
| TC-411 | `?status=cancelled` is always empty after a cancel | `GET /bookings?status=cancelled` | `cancelBooking` hard-deletes via `bookingRepository.delete` |
| TC-106 | Response `totalPrice` = price × quantity | `POST /bookings` | Secondary to the unit test |
| TC-102 | Response `bookingRef` matches `^<X>-[A-Z0-9]{6}$` | `POST /bookings` | Secondary to the unit test |

#### Seats, FIFO and cascades (need a real DB)
| TC | Title | Endpoint(s) | Service / code |
|---|---|---|---|
| TC-100 | 10th booking prunes the oldest booking for a different event | `POST /bookings` ×10, `GET /bookings` | `createBooking` FIFO block |
| TC-400 | 9 bookings → no prune; 10th → still 9 | same | `MAX_USER_BOOKINGS = 9` |
| TC-101 | Same-event fallback double-counts seats | `POST /bookings`, `GET /events/:id` | `sameEventFallback` → `decrementSeats` |
| TC-108 | Cancel restores seats on a user-created event | `DELETE /bookings/:id`, `GET /events/:id` | `withPersonalSeats` in `eventService.js:6` |
| TC-109 | Cancel restores seats on a static event; stored value unchanged | same | `withPersonalSeats` applies to all events |
| TC-110 | User A's booking doesn't change User B's seat count | `GET /events/:id` as A and B | `getBookedQuantitiesForEvents(userId, …)` |
| TC-111 | Clear all restores seats on every event | `DELETE /bookings`, `GET /events/:id` | `deleteAllForUser` |
| TC-112 | Deleting an event cascades to its bookings | `DELETE /events/:id`, `GET /bookings` | Prisma `onDelete: Cascade` |
| TC-113 | 7th event prunes the oldest event and its bookings | `POST /events` ×7, `GET /bookings` | `eventService.createEvent` FIFO + cascade |
| TC-114 | Same user, same event, two bookings | `POST /bookings` ×2 | No uniqueness constraint |
| TC-401 | Booking the exact remaining seats succeeds, then 1 more fails | `POST /bookings` | `personalAvailable < quantity` |
| TC-402 | Quantity 1 and 10 accepted | `POST /bookings` | `isInt({ min: 1, max: 10 })` |
| TC-406 | Clear all with 0 bookings → "0 booking(s) cleared" | `DELETE /bookings` | `clearAllBookings` controller |

#### Security
| TC | Title | Endpoint(s) | Enforcement point |
|---|---|---|---|
| TC-201 | Another user's booking by ID or ref → 403 | `GET /bookings/:id`, `GET /bookings/ref/:ref` | `getBookingById` uses `findByIdOnly`, then compares owner |
| TC-202 | Another user's cancel → **404**, booking intact | `DELETE /bookings/:id` | `cancelBooking` uses owner-scoped `findById(id, userId)` |
| TC-203 | No token → 401 on all six booking routes | all | `router.use(authMiddleware)` |
| TC-206 | Clear all only affects the caller | `DELETE /bookings` | `deleteAllForUser(userId)` |
| TC-207 | Fallback on a static event leaks a seat change to another user | `POST /bookings`, `GET /events/:id` as B | `eventRepository.decrementSeats` changes a shared row |
| TC-208 | Booking another user's dynamic event → 404 | `POST /bookings` | `eventRepository.findById` ownership `OR` |
| TC-209 | `?userId=` is ignored | `GET /bookings?userId=X` | `where = { userId }` from the JWT |

#### Negative and validation
| TC | Title | Endpoint | Code |
|---|---|---|---|
| TC-300 | Non-existent ID → 404 | `GET /bookings/99999999` | `NotFoundError` |
| TC-301 | Non-numeric ID → record the actual status (500 expected; this is a defect) | `GET` and `DELETE /bookings/abc` | No `:id` validator; `Number('abc')` is NaN |
| TC-302 | Second cancel → 404 | `DELETE /bookings/:id` ×2 | Hard delete |
| TC-303 | Unknown ref → 404 | `GET /bookings/ref/Z-000000` | `getBookingByRef` |
| TC-304 | Quantity above available seats → 400 with "Only N seat(s)…" | `POST /bookings` | `InsufficientSeatsError` |
| TC-305 | Unknown `eventId` → 404 | `POST /bookings` | `createBooking` |
| TC-306 | Field validation → 400 with `details[]` (data-driven table) | `POST /bookings` | `validateCreateBooking` |
| TC-407 | Email normalized (`normalizeEmail`) | `POST /bookings` | `bookingValidator.js` |
| TC-408 | Name trimmed before the length check | `POST /bookings` | `.trim().isLength({ min: 2 })` |
| TC-409 | Phone with `+ ( ) -` and spaces accepted | `POST /bookings` | Regex `^[0-9+\-\s()]+$` |

### 3.3 Component (primary: 25)
Implemented as single-page Playwright tests with `page.route('**/api/bookings**', …)` mocks (see §2). Sources: `frontend/app/bookings/page.tsx` (`BookingsContent`), `frontend/app/bookings/[id]/page.tsx` (`BookingDetailPage`, `RefundEligibility`), `frontend/components/bookings/BookingCard.jsx`, `frontend/app/admin/bookings/page.tsx`, `frontend/components/layout/Navbar.jsx`

| TC | Title | Component | What to mock or control |
|---|---|---|---|
| TC-103 | Quantity 1 → "Eligible for refund" | `RefundEligibility` | `GET /bookings/:id` with `quantity: 1` |
| TC-104 | Quantity 3 → "Group bookings (3 tickets)…" | `RefundEligibility` | `quantity: 3` |
| TC-403 | Quantity 2 boundary → not eligible | `RefundEligibility` | `quantity: 2` |
| TC-105 | Spinner shows for 4 s before the result | `RefundEligibility` | `page.clock.install()` then `clock.fastForward(4000)` |
| TC-507 | idle → checking → result; button doesn't return | `RefundEligibility` | Same clock control |
| TC-508 | Reload resets to idle | `RefundEligibility` | Reload with the same mock |
| TC-509 | 403 → "Access Denied"; 404 and 500 → "Booking not found" | `BookingDetailPage` | Mock status 403, 404, 500 |
| TC-502 | Detail spinner while loading | `BookingDetailPage` | Delay the route until released |
| TC-505 | Breadcrumb "My Bookings / <ref>" | `BookingDetailPage` | Fixed booking |
| TC-006 | "← Back" and the breadcrumb link go to `/bookings` | `BookingDetailPage` | Fixed booking |
| TC-503 | Dialog wording on the card and the detail page | `BookingCard`, `BookingDetailPage` | Fixed ref and quantity |
| TC-504 | Close and Escape send no DELETE | `ConfirmDialog` | Fail the test if `DELETE` is requested |
| TC-310 | Cancel 404 → error toast, dialog closes | `BookingCard` | `DELETE` returns 404 |
| TC-500 | 5 skeletons while loading | `BookingsContent` | Delayed list |
| TC-501 | Empty state plus "Browse Events" link | `BookingsContent` | `data: []` |
| TC-309 | Error state, then "Retry" recovers | `BookingsContent` | Fail, then succeed |
| TC-307 | Dismissing `confirm()` sends no request | `BookingsContent.handleClearAll` | Dialog dismissed (Playwright default); assert no `DELETE /bookings` |
| TC-308 | Clear-all 500 → no feedback (defect) | `handleClearAll` | `DELETE` returns 500 |
| TC-506 | "Clearing…" and disabled while pending | `handleClearAll` | Delay `DELETE` |
| TC-412 | 9 bookings → no pagination; `totalPages: 2` → pagination shown, `?page=2` | `BookingsContent` + `Pagination` | Mock `pagination` |
| TC-510 | "1 ticket" vs "2 tickets" | `BookingCard` | Two bookings |
| TC-512 | Confirmed badge; Cancel only when confirmed | `BookingCard`, admin row | Mock one `status: 'cancelled'` row |
| TC-514 | No limit banner on `/bookings` with 9 bookings | `BookingsContent` | 9 bookings |
| TC-009 | Admin table columns and the "View" modal | `AdminBookingsPage` | Fixed list |
| TC-513 | `nav-bookings` navigates and shows as active | `Navbar` | No mock needed |

All of these still need an authenticated page (because of `AuthGuard`). Put a token in `localStorage` with `addInitScript`; with every `/api/**` call mocked, the token never reaches the backend.

### 3.4 E2E (primary: 10, secondary: 3)
Real frontend and real backend. Source: `tests/booking-management.spec.js`

| TC | Title | Why it must be E2E | Status |
|---|---|---|---|
| TC-001 | Bookings list shows the new booking | Booking created in one page and listed in another | ✅ Exists |
| TC-002 | Detail page sections | Real data flows through the detail page | ✅ Exists (overlaps TC-001; see §6) |
| TC-007 | Confirmation → "View My Bookings" → new booking listed | Three pages, real booking | ✅ Exists as "TC-006" (wrong ID; see §6) |
| TC-003 | Cancel from detail → toast, redirect, removed | Mutation + navigation + cache invalidation | ✅ Exists |
| TC-004 | Cancel from list card → card removed, stays on `/bookings` | Different mutation path (`BookingCard`) | ❌ Missing. The existing "TC-004" test is clear-all |
| TC-005 | Clear all → empty state | Native `confirm()` + bulk delete | ✅ Exists as "TC-004" (wrong ID) |
| TC-200 | User B opening User A's booking → "Access Denied" | Needs two real sessions | ❌ Missing (P0) |
| TC-204 | Tampered token → `/login` and token removed | Axios interceptor + real 401 + `window.location` | ❌ Missing |
| TC-205 | No token → redirect to `/login` | `AuthGuard` routing | ❌ Missing |
| TC-511 | Event seat count after clear all, using client-side navigation | React Query cache across two pages; can't be seen at lower layers | ❌ Missing (likely defect) |
| TC-102 | Ref prefix on the confirmation card | Secondary: proves the rule reaches the user | ✅ Exists |
| TC-103 | Refund result for a real 1-ticket booking | Secondary: client-only rule with no API to cover it | ❌ Missing |
| TC-108 | Cancel → event page seat count goes back up | Secondary: the headline business rule end to end | ❌ Missing |

---

## 4. Rationale for contested assignments

### TC-103 / TC-104 / TC-403 / TC-105: refund eligibility → Component, plus one E2E
The rule (`quantity === 1`) exists only in `RefundEligibility` in `[id]/page.tsx`. No backend endpoint exists, so the API layer can't cover it. It's not exported as a function, so it can't be unit-tested yet. Component with a mocked booking is the lowest layer that works today. `page.clock` removes the real 4-second wait, so three cases cost about the same as one. A single E2E (TC-103) confirms a real booking's `quantity` reaches the component. Extracting `isRefundEligible(quantity)` (§7) would move TC-103/104/403 down to Unit.

### TC-100 / TC-101 / TC-400: FIFO → API primary, Unit secondary
The observable rule ("still 9 bookings; the oldest is gone") depends on `createdAt` ordering in MySQL, so the API is the source of truth. The Unit tests check the *decisions* inside `createBooking`: which booking is chosen, the `>= 9` threshold, and that `decrementSeats` receives the new quantity. They're cheap and point to the exact defect in TC-101. E2E is rejected: 10 bookings through the UI is about 10× slower and only adds DOM assertions.

### TC-108 / TC-109 / TC-110: seat computation → API primary
`withPersonalSeats` is a pure-looking `Math.max(0, availableSeats − userBooked)`, but `userBooked` comes from a `groupBy` query. The bugs to catch are in the query (wrong user, wrong event set), so Unit with mocks would miss them. TC-108 also gets one E2E because "seats come back on cancel" is the business rule the UI advertises in the cancel dialog.

### TC-200 vs TC-201 / TC-202: cross-user access → API and E2E
The API proves enforcement: 403 on GET, 404 on DELETE. The E2E proves the UI tells 403 apart from 404 and doesn't render another user's data. The 403-vs-404 *rendering* is also covered by mocks in TC-509 (Component). E2E TC-200 stays because it's P0 and a mock can't prove the real backend returns 403 to the real UI.

### TC-306 / TC-407 / TC-408 / TC-409: validation → API (not E2E, not separate Unit)
The validation chains are express-validator middleware. Unit-testing them means building fake `req` objects, which tests express-validator more than the app. One data-driven API test covers every field rule and the `{ error, details[] }` contract in a few hundred milliseconds. E2E is rejected: the booking form adds its own client-side behaviour, so a UI test wouldn't show which layer rejected the input.

### TC-307 / TC-308 / TC-506: clear-all states → Component (not E2E)
These depend on controlling the response of `DELETE /api/bookings` (fail, delay, never sent). Route mocks make that deterministic. Against the real backend you can't make it fail on demand. TC-005 (E2E) already covers the success path for real.

### TC-511: stale event cache → E2E
The defect only appears when React Query keeps `['events']` cached across client-side navigation after `handleClearAll` (which calls `refetch()` but doesn't invalidate `['events']`). A single-page Component test can't hold cross-page cache state. An API test can't see the cache. E2E is the only layer that reproduces it.

### TC-412: pagination → Component (not API, not E2E)
The API pagination contract is covered by TC-410. The UI question ("does pagination render, and does `?page=2` work?") can't be reached with real data, because the 9-booking cap is below the page size of 10. Only a mocked `totalPages: 2` can exercise it.

### TC-204 / TC-205: auth redirects → E2E
`AuthGuard` uses `router.replace('/login')`, and the 401 interceptor uses `window.location.href`. Both are full navigations that need the real app shell. They're fast (no data setup), so the E2E cost is low.

---

## 5. Defense-in-depth map

| Critical rule | Unit | API | Component | E2E |
|---|---|---|---|---|
| Ref prefix = first title character, uppercased | TC-102, TC-404 | TC-102 | — | TC-102 |
| Total = price × quantity | TC-106 | TC-106 | — | (asserted in TC-001/002 data) |
| Max 9 bookings, FIFO | TC-100, TC-400 | TC-100, TC-400 | — | — |
| Seats drop on booking and come back on cancel | — | TC-108, TC-109, TC-111 | — | TC-108 |
| Per-user seat isolation | TC-101 | TC-110, TC-207 | — | — |
| Cross-user access denied | — | TC-201, TC-202, TC-206, TC-208, TC-209 | TC-509 | TC-200 |
| Auth required | — | TC-203 | — | TC-204, TC-205 |
| Refund: 1 ticket eligible, more not | — | n/a (client only) | TC-103, TC-104, TC-403 | TC-103 |
| Cascade on event delete or prune | — | TC-112, TC-113 | — | — |

FIFO has no E2E on purpose (see §4). The UI only lists what the API returns.

---

## 6. Anti-patterns in existing tests (`tests/booking-management.spec.js`)

| # | Finding | Location | Severity | Fix |
|---|---|---|---|---|
| A1 | **Wrong TC IDs.** "TC-004" tests clear-all (now TC-005), "TC-006" tests View My Bookings (now TC-007), and the real TC-004 (cancel from card) isn't tested. The IDs predate the regenerated scenarios | lines 121, 202 | Medium | Renumber and add TC-004 |
| A2 | **Hardcoded `BASE_URL` to production**, duplicating `playwright.config.ts` `baseURL`. `page.goto(`${BASE_URL}/…`)` can't be pointed at localhost | line 3 and every `goto` | High | Use relative paths: `page.goto('/bookings')`, `toHaveURL(/\/bookings$/)` |
| A3 | **Shared public account with no isolation.** Every test runs `clearBookings` on `rahulshetty1@gmail.com`, which other trainees use at the same time. Concurrent runs delete each other's data, and TC-003's "No bookings yet" assertion becomes flaky | `login`, `clearBookings` | High | Register a unique user per test via the API, or at least per worker |
| A4 | **UI login and UI cleanup in every test.** Each test spends about 3 page loads on setup. The best-practices skill recommends API setup and `storageState` | every test | Medium | Log in via `POST /api/auth/login`, inject the token with `addInitScript`, and clean up with `DELETE /api/bookings` |
| A5 | **Non-retrying check.** `isVisible().catch(() => false)` runs before the list has loaded, so it usually returns false while the skeleton is still showing | `clearBookings` | Low | Clear via the API (A4), which makes the check unnecessary |
| A6 | **CSS-class and structure locators** where better options exist: `span.font-mono.font-bold` for the breadcrumb, `#confirm-dialog-yes` (a `data-testid` exists), `.confirm-booking-btn`, `.booking-ref` | lines 102, 188, 191 and helpers | Medium | Use `getByTestId('confirm-dialog-yes')`, a `getByRole('navigation')` scope for the breadcrumb, and ask for testids on the booking ref and confirm button (§7) |
| A7 | **Duplicated booking flow.** "TC-006" re-implements `bookEvent` inline | lines 121–153 | Low | Call `bookEvent(page)` |
| A8 | **TC-002 overlaps TC-001.** Both create a booking through the full UI just to reach the page they inspect. TC-002's section checks (headings present) are Component-level | lines 71–118 | Low | Keep one E2E for the list → detail journey; move section and heading checks to Component tests |
| A9 | **Unstable event choice.** "First card with Book Now" depends on shared seed order and other users' events. The title is read from `h3` | `bookEvent` | Low | Create a dedicated event via the API with a known title such as `QA-<timestamp>` |
| A10 | **`console.log` in tests.** Allowed for debugging (best practices §10), but it adds noise to CI output | helpers, TC-102 | Info | Remove, or use `test.info().annotations` |

No validation, API error codes or pure logic are tested at the E2E layer, so none of the main inverted-pyramid anti-patterns are present. The real gap is that the API, Unit and Component layers don't exist yet. Every current test is E2E (6 of 6).

---

## 7. Recommended code changes to unlock lower layers

| Change | File | Unlocks |
|---|---|---|
| Export `randomRef` and `generateUniqueRef` (e.g. `module.exports._internal = { randomRef, generateUniqueRef }`) | `backend/src/services/bookingService.js` | Unit TC-102, TC-404, TC-405 |
| Extract `isRefundEligible(quantity)` into `frontend/lib/` | `frontend/app/bookings/[id]/page.tsx` | Moves TC-103, TC-104, TC-403 to Unit |
| Add `data-testid="booking-ref"` (confirmation card and `BookingCard`) and `data-testid="confirm-booking-btn"`. The README already documents these, but the code only has class names | `app/events/[id]/page.tsx`, `BookingCard.jsx` | Removes A6 class locators |
| Add `data-testid="clear-all-bookings-btn"` | `app/bookings/page.tsx` | Stable locator for TC-005 and TC-307 |

---

## 8. Implementation order for `/generate-tests`

1. **API P0** (`tests/booking-management-api.spec.js`): TC-203, TC-201, TC-202, TC-206, TC-304, TC-306, TC-108, TC-110, TC-100/400. These need the fresh-user and own-event fixtures from §2.
2. **Fix the existing E2E file**: A1–A4, A6.
3. **Add missing E2E P0/P1**: TC-200, TC-004, TC-205, TC-204, TC-108 (secondary), TC-103 (secondary).
4. **Component** (`tests/booking-management-ui.spec.js`): TC-509, TC-103/104/403/105/507 with `page.clock`, then TC-307/308/309/310, then the remaining UI states.
5. **Defect probes** (expected to fail until fixed; mark with `test.fail()` and a comment): TC-101, TC-207, TC-301, TC-308, TC-511.
6. **Unit**: after the §7 exports. TC-102, TC-404, TC-405, TC-106, TC-100, TC-400, TC-101.
7. **API P2/P3**: the remainder.

---

## 9. Source map

| Area | Files |
|---|---|
| Routes and auth | `backend/src/routes/bookingRoutes.js`, `backend/src/middleware/authMiddleware.js` |
| Business logic | `backend/src/services/bookingService.js` (`createBooking`, `cancelBooking`, `clearAllBookings`, `getBookingById`, `getBookingByRef`, `getBookings`), `backend/src/services/eventService.js` (`withPersonalSeats`, `createEvent`) |
| Data access | `backend/src/repositories/bookingRepository.js` (`findById` vs `findByIdOnly`, `getBookedQuantitiesForEvents`), `eventRepository.js` (`findById` ownership `OR`, `decrementSeats`) |
| Validation and errors | `backend/src/validators/bookingValidator.js`, `backend/src/middleware/errorHandler.js`, `backend/src/utils/errors.js` |
| UI | `frontend/app/bookings/page.tsx`, `frontend/app/bookings/[id]/page.tsx`, `frontend/components/bookings/BookingCard.jsx`, `frontend/app/admin/bookings/page.tsx`, `frontend/components/ui/ConfirmDialog.jsx`, `frontend/components/auth/AuthGuard.tsx` |
| Client data | `frontend/lib/hooks/useBookings.ts` (cache invalidation), `frontend/lib/api/bookingsApi.js`, `frontend/lib/api/client.js` (401 interceptor) |
| Existing tests | `tests/booking-management.spec.js` |
