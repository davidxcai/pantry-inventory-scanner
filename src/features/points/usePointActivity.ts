import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { PointActivitySchema } from '../../../shared/pointActivity'
import { supabase } from '../../lib/supabase'
import { useSession } from '../auth/useSession'
import { readDevicePoints } from './devicePointsStore'
import { pointsUnavailable } from './usePoints'

export function usePointActivity(jobIds: string[]) {
  const session = useSession()
  const ids = [...new Set(jobIds)].sort()
  return useQuery({
    queryKey: ['inventory-point-activity', session?.user.id, ids],
    enabled: !!session && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_point_activity')
        .select('id,item_id,job_id,item_name,outcome,created_at,next_eligible_at').eq('user_id', session!.user.id).in('job_id', ids)
      if (error && pointsUnavailable(error)) return (await readDevicePoints(session!.user.id)).filter(entry => entry.job_id && ids.includes(entry.job_id))
      if (error) throw error
      return z.array(PointActivitySchema).parse(data)
    },
    refetchInterval: query => query.state.error || query.state.dataUpdateCount >= 15 || query.state.data?.length === ids.length ? false : 2000,
    retry: (failures, error) => !pointsUnavailable(error) && failures < 1,
  })
}
