# Local development

## Which dev server
The app is a Vite frontend plus Vercel functions in `api/`. Only `vercel dev` serves both.

| Command | Serves | Use for |
|---|---|---|
| `npm run dev` | Frontend only (Vite, port 5173, LAN-visible) | UI work that never calls `/api/*` |
| `npm run dev:api` | Frontend + `/api/*` (`vercel dev`, localhost only) | Anything that identifies a photo or reads a shelf, on this machine |
| `npm run dev:phone` | Frontend + `/api/*` (`vercel dev`, `0.0.0.0:5173`) | Testing on a phone over the LAN |

`npm run dev` and `dev:phone` both use port 5173, so a phone pointed at `http://<mac>:5173` reaches whichever one is running. Only one can hold the port, so stop the other first. Check what is on the port with `lsof -nP -iTCP:5173 -sTCP:LISTEN`.

## Pitfall: scans stuck on "Scanning…" under plain Vite
With `npm run dev`, every `/api/*` call returns 404. The failure is silent because the client sends those calls fire-and-forget:

1. `submitShelfScan` (`src/features/shelf/useShelfScans.ts`) uploads the photo and inserts the `shelf_scans` row. Both go straight to Supabase, so they succeed.
2. It then POSTs `/api/shelf` and ignores errors (`.catch(() => {})`). Under Vite this is a 404.
3. The row stays `queued` with `attempts = 0`. The review screen polls it every 4 s and keeps showing the spinner. Supabase logs show only repeated `GET /rest/v1/shelf_scans?id=eq.<id>` returning 200.

Add item (`/api/identify`) fails the same way.

**Diagnosis:** a scan or job still `queued` with 0 attempts means the server never received the request. If it is stuck in `processing`, the function started and died (see Known gaps).

**Recovery:**
- Switch to `npm run dev:phone` (or `dev:api`).
- Tap **Retry** on the catalog banner. The review screen has no retry for `queued`, only for `red`.
- Or run it from the terminal: `npm run shelf-scan <scan-id>`. It runs the same code as `/api/shelf` with the secret key. It only picks up scans in `queued`, `red` or `waiting_quota`, and it uses Gemini quota.

## Photos: camera vs library
`CameraView` (`src/features/intake/CameraView.tsx`) is used by both Add item and Update stock. It starts with **Choose from library** and **Take a photo**, with the camera off. Choosing from the library never requests camera access. **Take a photo** starts the live camera; cancelling it or switching to the library stops the stream. If live access is unavailable, a separate device-camera picker is offered.

The library file input has no `capture` attribute, so iOS and Android can open saved photos. Only the device-camera fallback uses `capture="environment"`. Saved HEIC/HEIF photos are converted to JPEG on the device when native browser decoding is unavailable. The decoder is loaded only when needed. Photo and thumbnail creation reuse one decoded original, and preparation errors leave the picker available to try again.

Run `npm run test:photos` for image preparation regression tests.

## Known gaps
- A `queued` scan on the review screen spins forever with no way to retry from that screen.
- A function killed at `maxDuration` (300 s) leaves the row in `processing`. `claimShelfScan` will not reclaim it, and the daily sweep only retries `waiting_quota`. Reset it by hand (`update shelf_scans set status = 'red' where id = …`), then retry.
