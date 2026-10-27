import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { CameraView } from '../intake/CameraView'
import { resizeToJpeg } from '../intake/image'
import { submitShelfScan } from './useShelfScans'

// Wide enough to read labels across a whole shelf.
const SHELF_SIDE = 2048

export function ShelfCaptureScreen() {
  const navigate = useNavigate()
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo])

  async function onPhoto(source: Blob) {
    setError(null)
    setPreparing(true)
    try {
      const blob = await resizeToJpeg(source, SHELF_SIDE, 0.85)
      setPhoto({ blob, url: URL.createObjectURL(blob) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo. Try another image.')
    } finally {
      setPreparing(false)
    }
  }

  async function send() {
    if (!photo) return
    setBusy(true)
    setError(null)
    try {
      await submitShelfScan(photo.blob)
      void navigate({ to: '/' })
    } catch (err) {
      // Supabase errors are not always Error instances, so read .message off any object.
      const message = (err as { message?: unknown } | null)?.message
      setError(typeof message === 'string' && message ? message : 'Could not upload the photo. Try again.')
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Update stock</h1>
        <Link to="/" className="btn btn-sm btn-ghost">Cancel</Link>
      </header>
      <p className="text-sm opacity-70">
        Photograph a whole shelf. We find the items we already list and ask you to check them. Anything you do not see
        here stays as it is.
      </p>

      {error && <div role="alert" className="alert alert-error alert-soft">{error}</div>}

      {photo ? (
        <>
          <img src={photo.url} alt="Captured shelf" className="w-full rounded-box bg-black object-contain" />
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-outline" disabled={busy} onClick={() => setPhoto(null)}>Change photo</button>
            <button className="btn btn-primary" disabled={busy} onClick={send}>
              {busy ? <span className="loading loading-spinner loading-sm" /> : 'Scan shelf'}
            </button>
          </div>
        </>
      ) : (
        <>
          <CameraView onPhoto={onPhoto} hint="Whole shelf, labels facing out" guide={false} disabled={preparing} />
          {preparing && <p role="status" className="text-center text-sm">Preparing photo…</p>}
        </>
      )}
    </main>
  )
}
