import type { JobStatus } from './useIntakeJobs'

const DOT: Record<JobStatus, { cls: string; label: string }> = {
  queued: { cls: 'bg-base-300', label: 'Queued' },
  processing: { cls: 'bg-info animate-pulse', label: 'Identifying' },
  green: { cls: 'bg-success', label: 'Saved' },
  yellow: { cls: 'bg-warning', label: 'Needs review' },
  red: { cls: 'bg-error', label: 'Failed, enter manually' },
  rejected: { cls: 'bg-error', label: 'Not accepted' },
  // Neutral on purpose: waiting for the daily quota reset is not a failure.
  waiting_quota: { cls: 'bg-neutral', label: 'Waiting for quota' },
  cancelled: { cls: 'bg-base-300', label: 'Cancelled' },
}

export function StatusDot({ status }: { status: JobStatus }) {
  const { cls, label } = DOT[status]
  return <span role="img" aria-label={label} title={label} className={`inline-block size-3 shrink-0 rounded-full ${cls}`} />
}

export const statusLabel = (s: JobStatus) => DOT[s].label
