import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { PublicAvailability } from '../../../shared/catalogView'
import type { RejectReason } from '../../../shared/guardrail'

export type JobStatus = 'queued' | 'processing' | 'green' | 'yellow' | 'red' | 'waiting_quota' | 'rejected' | 'cancelled'

export type IntakeJob = {
  id: string
  status: JobStatus
  availability: PublicAvailability
  error: string | null
  reject_reason: RejectReason | null
  model_used: string | null
  created_at: string
  identified: { name: string } | null
  items: { name: string; categories: string[] } | null
}

// Jobs for one batch, kept live through Realtime. Cancelled jobs are left out.
export function useIntakeJobs(batchId: string) {
  const queryClient = useQueryClient()
  const key = ['intake-jobs', batchId]

  useEffect(() => {
    const channel = supabase
      .channel(`intake-jobs-${batchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'intake_jobs', filter: `batch_id=eq.${batchId}` },
        () => void queryClient.invalidateQueries({ queryKey: ['intake-jobs', batchId] }),
      )
      .subscribe()
    return () => void supabase.removeChannel(channel)
  }, [batchId, queryClient])

  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<IntakeJob[]> => {
      const { data, error } = await supabase
        .from('intake_jobs')
        .select('id, status, availability, error, reject_reason, model_used, created_at, identified, items(name, categories)')
        .eq('batch_id', batchId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as IntakeJob[]
    },
    // Realtime is the main signal; polling covers a dropped socket.
    refetchInterval: 10_000,
  })
}
