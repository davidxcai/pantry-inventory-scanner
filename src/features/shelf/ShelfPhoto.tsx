import type { Detection, DetectionMatch } from '../../../shared/shelfScan'

const BOX: Record<DetectionMatch, string> = {
  matched: 'border-success bg-success text-success-content',
  candidates: 'border-warning bg-warning text-warning-content',
  unknown: 'border-base-content/60 bg-base-content/60 text-base-100',
}

// The shelf photo with a numbered box over each product the scan found. The numbers match the list;
// a product seen in several places gets the same number on each box.
export function ShelfPhoto({ url, detections }: { url: string; detections: Detection[] }) {
  return (
    <div className="relative">
      <img src={url} alt="Your shelf photo" className="w-full rounded-box bg-black" />
      {detections.flatMap((d, i) =>
        [d.box, ...(d.more_boxes ?? [])].map(([ymin, xmin, ymax, xmax], j) => (
          <div
            key={`${i}-${j}`}
            aria-hidden
            className={`pointer-events-none absolute border-2 ${BOX[d.match].split(' ')[0]}`}
            style={{ top: `${ymin / 10}%`, left: `${xmin / 10}%`, height: `${(ymax - ymin) / 10}%`, width: `${(xmax - xmin) / 10}%` }}
          >
            <span className={`absolute -top-px -left-px rounded-br px-1 text-xs font-semibold ${BOX[d.match].split(' ').slice(1).join(' ')}`}>
              {i + 1}
            </span>
          </div>
        )),
      )}
    </div>
  )
}
