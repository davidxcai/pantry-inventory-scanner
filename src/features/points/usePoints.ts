import { useQuery } from '@tanstack/react-query'
import { loadPoints, missingPointsBackend } from './devicePoints'

export const pointsUnavailable = missingPointsBackend

export function usePoints(userId: string | undefined) {
  return useQuery({
    queryKey: ['inventory-points', userId],
    enabled: !!userId,
    queryFn: () => loadPoints(userId!),
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: (failures, error) => !pointsUnavailable(error) && failures < 1,
  })
}
