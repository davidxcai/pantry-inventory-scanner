import { PointsHint } from '../points/PointsHint'
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { REJECT_LABELS, type RejectReason } from '../../../shared/guardrail'
import { startsChecked, type Detection } from '../../../shared/shelfScan'
import { RELATION_LABEL } from '../intake/matchLabels'
import { ShelfPhoto } from './ShelfPhoto'
import { requestShelfScan, useConfirmShelfScan, useShelfPhotoUrl, useShelfScan } from './useShelfScans'

// Check what a shelf scan found, then mark the ticked items in stock. A scan never marks anything
// low or out, and anything it did not list is left alone.
export function ShelfReviewScreen({ scanId }: { scanId: string }) {
  const { data: scan, error, refetch } = useShelfScan(scanId)
  const { data: photoUrl } = useShelfPhotoUrl(scan?.photo_path)
  const confirm = useConfirmShelfScan(scanId)
  const [checked, setChecked] = useState<Set<string> | null>(null)

  // Start with the confident matches ticked, once, when the result first arrives.
  useEffect(() => {
    if (scan?.status === 'ready' && scan.detections && !checked) {
      setChecked(new Set(scan.detections.filter(startsChecked).map((d) => d.item_id!)))
    }
  }, [scan, checked])

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  if (error) return <Shell><div role="alert" className="alert alert-error alert-soft">Could not load this scan.</div></Shell>
  if (!scan) return <Shell><span className="loading loading-spinner mx-auto" /></Shell>

  if (scan.status === 'queued' || scan.status === 'processing') {
    return (
      <Shell>
        <p className="flex items-center gap-2"><span className="loading loading-spinner loading-sm" /> Reading your shelf photo…</p>
        <p className="text-sm opacity-70">You can leave this page. We will show it on the catalog when it is ready.</p>
      </Shell>
    )
  }
  if (scan.status === 'confirmed' && !confirm.data) {
    return <Shell><p>This scan was already confirmed.</p><Link to="/" className="btn btn-primary">Back to the catalog</Link></Shell>
  }
  if (scan.status === 'rejected') {
    return (
      <Shell>
        <div role="alert" className="alert alert-error alert-soft">
          Photo not accepted{scan.reject_reason && `: ${REJECT_LABELS[scan.reject_reason as RejectReason] ?? scan.reject_reason}`}
        </div>
        <Link to="/shelf" className="btn btn-primary">Take another photo</Link>
      </Shell>
    )
  }
  if (scan.status !== 'ready') {
    return (
      <Shell>
        <p>{scan.status === 'waiting_quota' ? 'We are over our daily limit for reading photos. This scan will run after it resets.' : 'We could not read this photo.'}</p>
        {scan.error && scan.status !== 'waiting_quota' && <p className="text-xs opacity-60 break-words">{scan.error}</p>}
        <div className="flex gap-2">
          <button className="btn" onClick={() => void requestShelfScan(scanId).then(() => refetch())}>Try again</button>
          <Link to="/shelf" className="btn btn-primary">Take another photo</Link>
        </div>
      </Shell>
    )
  }

  const detections = scan.detections ?? []
  const selected = checked ?? new Set<string>()

  if (confirm.data) {
    const { updated, skipped } = confirm.data
    return (
      <Shell>
        <div role="status" className="alert alert-success alert-soft">Marked {updated} {updated === 1 ? 'item' : 'items'} in stock.</div>
        {confirm.data.devicePoints !== undefined && <p role="status">{confirm.data.devicePoints > 0 ? `+${confirm.data.devicePoints} points earned on this device.` : updated > 0 ? 'Stock saved. These products already earned points within seven days.' : 'No points earned: no products were updated.'}</p>}
        {skipped.length > 0 && (
          <div role="alert" className="alert alert-warning alert-soft">
            {skipped.length} could not be updated: {[...new Set(skipped.map((s) => s.reason))].join('; ')}
          </div>
        )}
        <Link to="/" className="btn btn-primary">Back to the catalog</Link>
      </Shell>
    )
  }

  return (
    <Shell>
      {photoUrl && <ShelfPhoto url={photoUrl} detections={detections} />}
      {!detections.length && <p className="opacity-70">We could not find any products in that photo.</p>}

      <ul className="flex flex-col gap-2">
        {detections.map((d, i) => (
          <DetectionRow key={i} n={i + 1} d={d} selected={selected} onToggle={toggle} />
        ))}
      </ul>

      {confirm.error && <div role="alert" className="alert alert-error alert-soft">{confirm.error.message}</div>}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 bg-base-100/90 p-4 backdrop-blur">
        <button className="btn btn-primary" disabled={!selected.size || confirm.isPending} onClick={() => confirm.mutate([...selected])}>
          {confirm.isPending ? <span className="loading loading-spinner loading-sm" /> : `Mark ${selected.size} ${selected.size === 1 ? 'item' : 'items'} in stock`}
        </button>
        <p className="text-center text-xs opacity-70">Items not ticked, and items not in the photo, are not changed.</p>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Check your shelf scan</h1>
        <Link to="/" className="btn btn-sm btn-ghost">Close</Link>
      </header>
      <PointsHint />
      {children}
    </main>
  )
}

type RowProps = { n: number; d: Detection; selected: Set<string>; onToggle: (id: string) => void }

function DetectionRow({ n, d, selected, onToggle }: RowProps) {
  return (
    <li className="rounded-box bg-base-200 p-3">
      <div className="flex items-start gap-3">
        <span className="badge badge-sm badge-neutral mt-0.5">{n}</span>
        <div className="min-w-0 flex-1">
          {d.match === 'matched' && d.item_id && (
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" className="checkbox checkbox-sm" checked={selected.has(d.item_id)} onChange={() => onToggle(d.item_id!)} />
              <span className="font-medium">{d.item_name}</span>
              {d.confidence === 'low' && <span className="badge badge-warning badge-soft badge-sm">Not sure</span>}
            </label>
          )}
          {d.match === 'candidates' && (
            <>
              <p className="text-sm">Read as <span className="font-medium">{d.name}</span>. Is it one of these?</p>
              <ul className="mt-1 flex flex-col gap-1">
                {d.candidates.map((c) => (
                  <li key={c.item_id}>
                    <label className="flex cursor-pointer items-center gap-3">
                      <input type="checkbox" className="checkbox checkbox-sm" checked={selected.has(c.item_id)} onChange={() => onToggle(c.item_id)} />
                      <span>{c.name}</span>
                      <span className="text-xs opacity-60">{RELATION_LABEL[c.relation]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {d.match === 'unknown' && (
            <>
              <p className="font-medium">{d.name}</p>
              <p className="text-sm opacity-70">Not in the catalog yet.</p>
              <Link to="/capture" className="btn btn-xs btn-outline mt-1">Add it with a close-up photo</Link>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
