import { PointReceipt } from '../points/PointReceipt'
import { usePointActivity } from '../points/usePointActivity'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { defaultsToNewItem, matchJob } from '../../../shared/matchJob'
import { CategoriesSchema } from '../../../shared/categories'
import { CategoryPicker } from './CategoryPicker'
import { StatusDot, statusLabel } from './StatusDot'
import { RELATION_LABEL } from './matchLabels'
import { availabilityText } from './availability'
import type { Category } from './categories'
import { useReviewJob, type ItemFields } from './useReviewJob'

const thumbUrl = (path: string | null) => (path ? supabase.storage.from('thumbnails').getPublicUrl(path).data.publicUrl : undefined)

// Resolve one job: pick an existing item (its stock level is updated), create a new one, or check
// an item that was created automatically. Also the manual-entry screen for red and waiting jobs.
export function ReviewScreen({ jobId }: { jobId: string }) {
  const navigate = useNavigate()
  const { job, catalog, photoUrl, useExisting, createNew, confirmItem } = useReviewJob(jobId)
  const activity = usePointActivity([jobId])
  const j = job.data

  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [seeded, setSeeded] = useState(false)

  // Fill the form once: from the created item if there is one, else from what Gemini read.
  useEffect(() => {
    if (!j || seeded) return
    const src = j.items ?? j.identified
    setName(src?.name ?? '')
    setBrand(src?.brand ?? '')
    setCategories((src?.categories ?? []) as Category[])
    setSeeded(true)
  }, [j, seeded])

  const hasItem = !!j?.item_id
  const valid = name.trim().length > 0 && CategoriesSchema.safeParse(categories).success
  const fields: ItemFields = { name: name.trim(), brand: brand.trim(), categories }

  // Live candidates from the typed name, so a manual entry is also checked against the catalog.
  const matches = useMemo(() => {
    if (hasItem || !name.trim() || !catalog.data) return []
    const m = matchJob(name, catalog.data)
    if (m.kind === 'new') return []
    if (m.kind === 'green') return [{ item_id: m.itemId, name: catalog.data.find((c) => c.id === m.itemId)!.name, relation: 'same' as const }]
    return m.candidates
  }, [hasItem, name, catalog.data])

  const thumbs = new Map((catalog.data ?? []).map((c) => [c.id, c.thumbnail_path]))
  const busy = useExisting.isPending || createNew.isPending || confirmItem.isPending
  const failure = useExisting.error ?? createNew.error ?? confirmItem.error

  const back = () => void navigate({ to: '/queue' })

  if (job.isLoading) return <span className="loading loading-spinner mx-auto mt-10 block" />
  if (job.error || !j) return <p className="p-4 text-error">Could not load this job.</p>

  // Already saved: nothing left to decide.
  if (j.status === 'green') {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <StatusDot status={j.status} /> {j.items?.name ?? 'Saved'}
        </h1>
        <p className="text-sm opacity-70">Marked {availabilityText(j.availability)}.</p>
        <PointReceipt activity={activity.data?.[0]} />
        <Link to="/queue" className="btn btn-primary">Back to queue</Link>
      </main>
    )
  }

  const newIsPrimary = !matches.length || defaultsToNewItem(matches)

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <StatusDot status={j.status} /> {hasItem ? 'Check this item' : 'Which item is this?'}
        </h1>
        <Link to="/queue" className="btn btn-sm btn-ghost">Back</Link>
      </header>

      {photoUrl.data && <img src={photoUrl.data} alt="Captured item" className="max-h-72 w-full rounded-box bg-black object-contain" />}
      <p className="text-sm opacity-70">
        {statusLabel(j.status)} · Marked {availabilityText(j.availability)}
        {j.error && ` · ${j.error}`}
        {j.identified?.note && ` · Note: ${j.identified.note}`}
        {j.identified?.confidence === 'low' && ' · Low confidence read'}
      </p>

      <label className="form-control flex flex-col gap-1">
        <span className="text-sm font-medium">Name</span>
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Brand + product + variety" />
      </label>
      <label className="form-control flex flex-col gap-1">
        <span className="text-sm font-medium">Brand</span>
        <input className="input w-full" value={brand} onChange={(e) => setBrand(e.target.value)} />
      </label>
      <CategoryPicker value={categories} onChange={setCategories} />

      {!hasItem && matches.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Already in the pantry? Update it instead of adding a duplicate.</h2>
          {matches.map((c) => (
            <div key={c.item_id} className="flex items-center gap-3 rounded-box bg-base-200 p-2">
              <img src={thumbUrl(thumbs.get(c.item_id) ?? null)} alt="" className="size-14 rounded-field bg-base-300 object-cover" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-xs opacity-70">{RELATION_LABEL[c.relation]}</div>
              </div>
              <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => useExisting.mutate(c.item_id, { onSuccess: back })}>
                Update this item
              </button>
            </div>
          ))}
        </section>
      )}

      <PointReceipt activity={activity.data?.[0]} />
      {failure && <div role="alert" className="alert alert-error alert-soft">{failure.message}</div>}

      {hasItem ? (
        <button className="btn btn-primary" disabled={busy || !valid} onClick={() => confirmItem.mutate(fields, { onSuccess: back })}>
          Confirm
        </button>
      ) : (
        <button
          className={`btn ${newIsPrimary ? 'btn-primary' : 'btn-outline'}`}
          disabled={busy || !valid}
          onClick={() => createNew.mutate(fields, { onSuccess: back })}
        >
          Create as a new item
        </button>
      )}
    </main>
  )
}
