import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { IconRepeat } from '@tabler/icons-react'
import { CameraView } from './CameraView'
import { makeCapture } from './image'
import { useCaptureQueue } from './useCaptureQueue'

type Review = { photo: Blob; thumb: Blob; url: string }

export function CaptureScreen() {
  const { enqueue, last, pending } = useCaptureQueue()
  const [review, setReview] = useState<Review | null>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(0)

  useEffect(() => () => void (review && URL.revokeObjectURL(review.url)), [review])

  async function onPhoto(source: Blob) {
    setError(null)
    setPreparing(true)
    try {
      const { photo, thumb } = await makeCapture(source)
      setReview({ photo, thumb, url: URL.createObjectURL(photo) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo. Try another image.')
    } finally {
      setPreparing(false)
    }
  }

  function sameAsLast() {
    if (!last) return
    setReview({ photo: last.photo, thumb: last.thumb, url: URL.createObjectURL(last.photo) })
  }

  async function confirm() {
    if (!review) return
    setBusy(true)
    setError(null)
    try {
      await enqueue(review.photo, review.thumb, 'in_stock')
      setAdded((n) => n + 1)
      setReview(null)
    } catch {
      setError('Could not save the photo on this device. Free some storage or allow site storage, then try Confirm again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Add an item</h1>
        <Link to="/queue" className="btn btn-sm btn-ghost">
          Queue{added > 0 && <span className="badge badge-primary">{added}</span>}
          {pending.length > 0 && <span className="badge badge-warning">{pending.length} uploading</span>}
        </Link>
      </header>

      {error && <div role="alert" className="alert alert-error alert-soft">{error}</div>}

      {review ? (
        <>
          <img src={review.url} alt="Captured item" className="aspect-[3/4] w-full rounded-box bg-black object-contain" />
          <p className="text-center text-xs opacity-70">
            The photo confirms the item is here. If we already have it, it is marked in stock; otherwise it is added as a new item.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button className="btn btn-outline" disabled={busy} onClick={() => setReview(null)}>Change photo</button>
            <button className="btn btn-primary" disabled={busy} onClick={confirm}>Confirm</button>
          </div>
        </>
      ) : (
        <>
          <CameraView onPhoto={onPhoto} disabled={preparing} />
          {preparing && <p role="status" className="text-center text-sm">Preparing photo…</p>}
          {last && (
            <button className="btn btn-ghost btn-block" disabled={preparing} onClick={sameAsLast}>
              <IconRepeat size={18} /> Same item as last photo
            </button>
          )}
        </>
      )}
    </main>
  )
}
