import { createFileRoute } from '@tanstack/react-router'
import { VisitReviewScreen } from '../features/points/VisitReviewScreen'

export const Route = createFileRoute('/visit-review')({
  validateSearch: (search: Record<string, unknown>): { request?: string } => ({
    request: typeof search.request === 'string' ? search.request : undefined,
  }),
  component: ReviewPage,
})
function ReviewPage() {
  const { request } = Route.useSearch()
  return <VisitReviewScreen requestId={request} />
}
