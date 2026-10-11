# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
EventHub is a full-stack event ticket booking platform built for QA training. Users can browse events, book tickets, manage bookings, and create events. Each user operates in an isolated sandbox.

## Tech Stack
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript + JSX mix, Tailwind CSS, React Query v5, Axios
- **Backend**: Express.js (plain JavaScript, no TS), Prisma 5 ORM, MySQL 8+, express-validator, Swagger UI at `/api/docs`
- **Auth**: JWT (7-day expiry), bcryptjs
- **Testing**: Playwright E2E (Chromium only)

## Commands
Run from the repo root unless noted.
```bash
npm run setup        # npm install in backend/ and frontend/
npm run dev          # Start backend (3001, nodemon) + frontend (3000) concurrently
npm run db:push      # Push Prisma schema to DB (non-interactive)
npm run migrate      # prisma migrate dev (interactive)
npm run seed         # Seed 10 static events
npm run build        # Build the Next.js frontend
npm run lint         # next lint (frontend only; backend has no linter)
npm run test         # Run all Playwright tests
npm run test:ui      # Playwright UI mode
npx playwright test tests/<file>.spec.js --reporter=line   # Single file
npx playwright test -g "<test title>"                      # Single test by name
docker compose up --build   # Run the Playwright suite in a container
```
Backend extras (`cd backend`): `npm run prisma:generate`, `npm run prisma:studio`.

**Playwright `baseURL` is the deployed site (`https://eventhub.rahulshettyacademy.com`), not localhost** (see `playwright.config.ts`). To test local changes, override `baseURL` to `http://localhost:3000`. Config: 30s test timeout, 5s expect timeout, no retries, not fully parallel.

### Environment
- `backend/.env` (template: `backend/.env.example`): `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `JWT_SECRET`, `SHOW_EXPLORE_LINKS`
- `frontend/.env.local`: `NEXT_PUBLIC_API_URL=http://localhost:3001/api`

### CI checks (`.github/workflows/`)
- `ci.yml` (PRs to main): backend `node --check server.js app.js`, `prisma validate`, **`prisma format` must produce no diff** (run `cd backend && npx prisma format` before committing schema changes), `prisma generate`, schema drift check against prod DB, frontend type-check + build.
- `playwright.yml`: runs E2E on push to main. `deploy.yml`: deploys to production via SSH/PM2 after CI passes.

## Architecture

### Backend (`backend/`)
Layered: Routes → Controllers → Services → Repositories → Prisma. `app.js` wires middleware and mounts `/api/auth`, `/api/events`, `/api/bookings`, plus `/api/health` and `/api/config` (feature flags); `server.js` starts the server.
- **Routes** carry Swagger JSDoc (feeds `/api/docs`), express-validator middleware from `validators/`, and `authMiddleware` (Bearer JWT → `req.user = { userId, email }`).
- **Services** hold all business rules and take `userId` as an explicit argument for sandbox scoping.
- **Errors**: services throw classes from `src/utils/errors.js` (`NotFoundError` 404, `ValidationError`/`InsufficientSeatsError` 400, `ForbiddenError` 403); `middleware/errorHandler.js` maps them to `{ success: false, error }` JSON. Successful responses use `{ success, data, pagination? }`.

### Per-user sandbox model (spans repositories + services)
- `Event.isStatic = true` → seeded, visible to all, immutable (update/delete throw `ForbiddenError`). User-created events have `isStatic = false` and `userId` set; repositories filter events with `OR: [{ isStatic: true }, { userId }]`, so users never see each other's events.
- **Seats are computed per user, not shared**: `eventService.withPersonalSeats` returns `availableSeats = event.availableSeats − (this user's booked quantity)`. Booking creation checks against that same personal number; cancellation just deletes the booking (no event update). The stored `availableSeats` is only decremented in the FIFO same-event fallback case.
- **FIFO limits**: max 6 dynamic events per user (`MAX_USER_DYNAMIC_EVENTS`, oldest deleted) and max 9 bookings (`MAX_USER_BOOKINGS`, oldest pruned, preferring a booking for a different event).
- **Booking ref**: `<first letter of event title, uppercased>-<6 alphanumerics>`, e.g. `T-A3B2C1` (the README's `EVT-XXXXXX` format is outdated).
- Accessing another user's booking → `ForbiddenError` → UI shows "Access Denied".

### Frontend (`frontend/`)
- `lib/api/client.js`: Axios instance that attaches the JWT from `localStorage['eventhub_token']`, unwraps responses to the API body, and on 401 clears the token and redirects to `/login`.
- `lib/api/*Api.js` → `lib/hooks/use*.ts` (React Query hooks) → pages in `app/` (`events`, `bookings`, `admin`, `login`, `register`).
- Refund eligibility (1 ticket = eligible, >1 = not eligible) is computed client-side only.
- Key elements have `data-testid` attributes; check component source before assuming a selector exists.

## Testing Conventions
- Test files go in `tests/` as `<feature-name>.spec.js` (JavaScript)
- Follow the `playwright-best-practices` skill (`.claude/skills/playwright-best-practices/SKILL.md`)
- Locator priority: data-testid > role > label/placeholder > ID > CSS class
- No `page.waitForTimeout()`; use web-first assertions like `expect().toBeVisible()`
- Tests must be self-contained (login → action → assert); add step comments
- Test account: `rahulshetty1@gmail.com` / `Magiclife1!`

## Claude Skills (`.claude/skills/`)
User-invocable agents:
- `/generate-tests <feature>`: writes Playwright tests and validates them in a real browser
- `/review-tests <file>`: reviews test code quality against the best-practices skill
- `/create-scenarios <area>`: writes functional test scenarios to `docs/test-scenarios.md`
- `/test-strategy <scenarios>`: assigns scenarios to pyramid layers, output in `docs/test-strategy.md`

Reference skills (auto-loaded, not user-invocable):
- `eventhub-domain`: business rules, API reference, user flows, UI selectors (sub-files in `.claude/skills/eventhub-domain/`)
- `playwright-best-practices`: testing standards

## Code Style
- Backend: CommonJS JavaScript with JSDoc, Express patterns
- Frontend: TypeScript for hooks/types/pages; many components are `.jsx`. React hooks, Tailwind utility classes
- Tests: JavaScript with the Playwright test runner
