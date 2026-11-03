# Local development

## Which dev server
The app is a Vite frontend plus Vercel functions in `api/`. For photo identification, run local functions with `vercel dev`, or configure Vite to proxy photo requests to an existing deployed backend.

| Command | Serves | Use for |
|---|---|---|
| `npm run dev` | Vite frontend, plus photo API proxy when configured (port 5173) | UI work and photo uploads using the deployed backend |
| `npm run dev:api` | Frontend + `/api/*` (`vercel dev`, localhost only) | Anything that identifies a photo or reads a shelf, on this machine |
| `npm run dev:phone` | Frontend + `/api/*` (`vercel dev`, `0.0.0.0:5173`) | Testing on a phone over the LAN |

`npm run dev` and `dev:phone` both use port 5173, so a phone pointed at `http://<mac>:5173` reaches whichever one is running. Only one can hold the port, so stop the other first. Check what is on the port with `lsof -nP -iTCP:5173 -sTCP:LISTEN`.

## Photo identification with the deployed backend

If you have the app's public Supabase credentials but no local Gemini/service credentials, add this server-only setting to `.env.local`:

```dotenv
DEV_API_ORIGIN=https://pantry-inventory-scanner.vercel.app
```

The configured backend must use the same Supabase project as `VITE_SUPABASE_URL`. This repository's documented deployment was checked against the current local project. Restart Vite after changing configuration if it does not restart automatically.

Vite proxies `/api/identify` and `/api/shelf` to that backend, including the signed-in user's authorization header. The frontend stays on localhost; service and model keys remain on the backend. These operations use real catalog data and the backend's normal identification quotas. The proxy only affects development; deployed Vercel functions continue handling production requests normally. For fully local API work use `npm run dev:api` with its required server credentials.

## Diagnosing a queued photo

A photo can upload to Supabase successfully while identification fails separately. A job still `queued` with zero attempts usually means the backend never received its request. Under Vite without `DEV_API_ORIGIN`, the photo API returns a 404; this used to leave jobs stuck with no explanation.

Add item now keeps identification errors in the queue, shows **Identifying…** while a request is running, disables overlapping retries for the same photo, and lets you retry without uploading it again. HTML frontend responses, expired sessions, network failures, and backend errors are surfaced instead of counted as success. Upload errors identify whether the full photo, preview, or job record failed.

After configuring the backend, open Queue and tap **Retry** on previously queued photos. Successful matches become Saved; ambiguous or new products offer Review. You can also enter the details manually using Enter on a queued or failed item. A failed recognition request does not discard the uploaded photo.

Shelf scans use the same API proxy. Retry a queued shelf scan from its catalog banner. Alternatively `npm run shelf-scan <scan-id>` runs the backend code with local server credentials.

Run `npm exec vitest run scripts/photo-api.test.ts scripts/capture-queue.test.ts scripts/photo-upload.test.ts` for the request, queue and photo-preparation regressions.

## Photos: camera vs library
`CameraView` (`src/features/intake/CameraView.tsx`) is used by both Add item and Update stock. It starts with **Choose from library** and **Take a photo**, with the camera off. Choosing from the library never requests camera access. **Take a photo** starts the live camera; cancelling it or switching to the library stops the stream. If live access is unavailable, a separate device-camera picker is offered.

The library file input has no `capture` attribute, so iOS and Android can open saved photos. Only the device-camera fallback uses `capture="environment"`. Saved HEIC/HEIF photos are converted to JPEG on the device when native browser decoding is unavailable. The decoder is loaded only when needed. Photo and thumbnail creation reuse one decoded original, and preparation errors leave the picker available to try again.

Run `npm run test:photos` for image preparation regression tests.

## Known gaps
- A `queued` scan on the review screen spins forever with no way to retry from that screen.
- A function killed at `maxDuration` (300 s) leaves the row in `processing`. `claimShelfScan` will not reclaim it, and the daily sweep only retries `waiting_quota`. Reset it by hand (`update shelf_scans set status = 'red' where id = …`), then retry.
