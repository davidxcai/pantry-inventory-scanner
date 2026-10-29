# Pantry Inventory Scanner

A live inventory system for a campus food pantry. Students can see what is in stock before booking an appointment, and pantry volunteers keep the list current by snapping a photo of an item or a shelf.

**Use the app: https://pantry-inventory-scanner.vercel.app/**

## Why

The UTA pantry doesn't publish what it has beyond a limited weekly Instagram post, and visits require an appointment. Students can book a slot and arrive to find the item they wanted is gone. This app gives them a searchable, up-to-date catalog instead.

## How it works

1. A signed-in volunteer photographs an item (or a whole shelf) with their phone, from the camera or the photo library.
2. AI image classification (Google Gemini) identifies the product and its name.
3. The volunteer confirms a stock level: **in stock**, **low** or **out**.
4. If the item already exists in the pantry, the photo updates its stock level instead of creating a duplicate.
5. Everyone can browse the catalog on the website.

## Tech stack

- **Frontend:** React 19, Vite, TypeScript, TanStack Router and Query, Tailwind CSS 4 with daisyUI, Zustand
- **Backend:** Vercel Functions in `api/` (`identify`, `shelf`, `sweep`)
- **Data and auth:** Supabase (Postgres, storage, row-level security)
- **AI:** Google Gemini (`@google/genai`), plus on-device embeddings for matching (`@huggingface/transformers`)

## Project layout

| Path | Contents |
|---|---|
| `src/` | React app: routes and feature modules (`auth`, `catalog`, `checkin`, `intake`, `shelf`) |
| `api/` | Vercel serverless functions |
| `shared/` | Logic shared by the app, API and scripts (matching, freshness, guardrails, shelf scans) with tests |
| `supabase/` | Migrations and seed data |
| `scripts/` | CLI tools for identification, matching, shelf scans and end-to-end checks |
| `docs/` | Design notes and plans |

## Running locally

Requires Node.js and a Supabase project.

```bash
npm install
```

Create a `.env.local` with:

| Variable | Used by |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | API and scripts |
| `GEMINI_API_KEY` | Item and shelf identification |
| `CRON_SECRET` | Protects the `sweep` endpoint |

Then pick a dev server:

| Command | Serves |
|---|---|
| `npm run dev` | Frontend only (UI work that never calls `/api/*`) |
| `npm run dev:api` | Frontend and `/api/*` via `vercel dev` |
| `npm run dev:phone` | Same as above, reachable from a phone on your LAN |

Photo identification needs the API, so use `dev:api` or `dev:phone` for it. Under plain `npm run dev`, scans stay stuck on "Scanning…". See [docs/local-development.md](docs/local-development.md) for details and recovery steps.

## Scripts

| Command | Purpose |
|---|---|
| `npm run build` | Production build and typecheck |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests for `shared/` |
| `npm run test:photos` | Photo preparation tests |
| `npm run shelf-scan <scan-id>` | Run a queued shelf scan from the terminal |

## Documentation

More background is in [`docs/`](docs/): the implementation plan, status verification, presence gate, reservations, notifications and prediction model notes.
