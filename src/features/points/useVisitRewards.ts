import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { VisitRequestSchema } from '../../../shared/visitRewards'
import { supabase } from '../../lib/supabase'
import { pointsUnavailable } from './usePoints'

export function useVisitActions(userId: string | undefined) {
  const client = useQueryClient()
  const requestId = useRef<string | null>(null)
  return useMutation({
    mutationFn: async (action: { type: 'request' } | { type: 'cancel'; id: string } | { type: 'review'; id: string; decision: 'approved' | 'rejected'; note: string }) => {
      if (!userId) throw new Error('Sign in to continue')
      let result
      if (action.type === 'request') {
        requestId.current ??= crypto.randomUUID()
        result = await supabase.rpc('request_extra_visit', { p_request_id: requestId.current })
      } else if (action.type === 'cancel') result = await supabase.rpc('cancel_extra_visit', { p_request_id: action.id })
      else result = await supabase.rpc('review_extra_visit', { p_request_id: action.id, p_decision: action.decision, p_note: action.note })
      if (result.error) throw new Error(result.error.message)
      requestId.current = null
      return result.data
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['inventory-points'] }),
        client.invalidateQueries({ queryKey: ['visit-reviews'] }),
      ])
    },
  })
}
export function useVisitReviews(userId: string | undefined, id?: string) {
  return useQuery({
    queryKey: ['visit-reviews', userId, id], enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_visit_reward_requests', { p_request_id: id ?? null })
      if (error) throw new Error(pointsUnavailable(error) ? 'Visit request reviews are not enabled for this pantry yet.' : error.message)
      return z.array(VisitRequestSchema).parse(data)
    },
    retry: false, refetchInterval: 10_000,
  })
}
