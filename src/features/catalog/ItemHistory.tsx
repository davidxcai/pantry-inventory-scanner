import { timeAgo } from '../../../shared/freshness'
import { availabilityLabel } from './AvailabilityBadge'
import { useItemHistory, type HistoryEntry } from './useItemHistory'

const DOT: Record<HistoryEntry['status'], string> = {
  in_stock: 'bg-success',
  low: 'bg-warning',
  out: 'bg-error',
}

const describe = (e: HistoryEntry) =>
  `${e.kind === 'confirm' ? 'Confirmed' : 'Marked'} ${availabilityLabel(e.status).toLowerCase()}`

// Short "who changed this and when" list for the item dialog. Hidden while loading or on error:
// the dialog's own "Updated … by …" line already covers the latest change.
export function ItemHistory({ itemId }: { itemId: string }) {
  const history = useItemHistory(itemId)
  if (!history.data) return null

  return (
    <section className="mt-3">
      <h3 className="mb-1 text-xs font-semibold uppercase opacity-60">Recent updates</h3>
      {history.data.length === 0 ? (
        <p className="text-xs opacity-70">No updates from students yet.</p>
      ) : (
        <ul className="timeline timeline-vertical timeline-compact">
          {history.data.map((e, i) => (
            <li key={`${e.created_at}-${i}`}>
              {i > 0 && <hr />}
              <div className="timeline-middle">
                <span className={`block size-2 rounded-full ${DOT[e.status]}`} />
              </div>
              <div className="timeline-end py-1 text-xs">
                <span className="font-medium">{describe(e)}</span>
                <span className="opacity-70"> · {e.display_name ?? 'A student'} · {timeAgo(e.created_at)}</span>
              </div>
              {i < history.data.length - 1 && <hr />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
