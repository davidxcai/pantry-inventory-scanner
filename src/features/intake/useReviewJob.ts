import { inventoryProductKey } from '../../../shared/deviceInventoryPoints'
import { recordDeviceJob } from '../points/devicePoints'
import { refreshPoints } from '../points/refreshPoints'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { PublicAvailability } from '../../../shared/catalogView'
import type { JobCandidate } from '../../../shared/matchJob'
import type { IdentifiedItem } from '../../../shared/identifyItem'
import type { JobStatus } from './useIntakeJobs'

export type ReviewJob = {
  id: string
  status: JobStatus
  availability: PublicAvailability
  photo_path: string
  item_id: string | null
  candidates: JobCandidate[] | null
  identified: IdentifiedItem | null
  error: string | null
  items: { id: string; name: string; brand: string | null; categories: string[] } | null
}

export type CatalogEntry = { id: string; name: string; brand: string | null; thumbnail_path: string | null; categories: string[] }

export type ItemFields = { name: string; brand: string; categories: string[] }

export function useReviewJob(jobId: string) {
  const queryClient = useQueryClient()

  const job = useQuery({
    queryKey: ['review-job', jobId],
    queryFn: async (): Promise<ReviewJob> => {
      const { data, error } = await supabase
        .from('intake_jobs')
        .select('id, status, availability, photo_path, item_id, candidates, identified, error, items(id, name, brand, categories)')
        .eq('id', jobId)
        .single()
      if (error) throw error
      return data as unknown as ReviewJob
    },
  })

  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: async (): Promise<CatalogEntry[]> => {
      const { data, error } = await supabase.from('items').select('id, name, brand, thumbnail_path, categories').order('name').limit(5000)
      if (error) throw error
      return data
    },
  })

  const photoUrl = useQuery({
    queryKey: ['review-photo', job.data?.photo_path],
    enabled: !!job.data,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('intake-photos').createSignedUrl(job.data!.photo_path, 3600)
      if (error) throw error
      return data.signedUrl
    },
  })

  const done = () => {
    void refreshPoints(queryClient)
    void queryClient.invalidateQueries({ queryKey: ['intake-jobs'] })
    void queryClient.invalidateQueries({ queryKey: ['review-job', jobId] })
    void queryClient.invalidateQueries({ queryKey: ['catalog'] })
  }

  // This photo is an item we already have: its status is updated to what the user chose.
  const useExisting = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.rpc('resolve_job_existing', { p_job_id: jobId, p_item_id: itemId })
      if (error) throw error
      await recordDeviceJob(jobId)
    },
    onSuccess: done,
  })

  // This photo is a new item.
  const createNew = useMutation({
    mutationFn: async (f: ItemFields) => {
      const key = inventoryProductKey(f.name, f.brand)
      const existing = catalog.data?.find(item => inventoryProductKey(item.name,item.brand) === key)
      const { error } = existing
        ? await supabase.rpc('resolve_job_existing', { p_job_id: jobId, p_item_id: existing.id })
        : await supabase.rpc('resolve_job_new', {
          p_job_id: jobId, p_name: f.name, p_brand: f.brand || null,
          p_size: job.data?.identified?.size ?? null, p_categories: f.categories,
        })
      if (error) throw error
      await recordDeviceJob(jobId)
    },
    onSuccess: done,
  })

  // The item was created from this photo; save the user's edits and accept it.
  const confirmItem = useMutation({
    mutationFn: async (f: ItemFields) => {
      const { error } = await supabase.rpc('confirm_job', {
        p_job_id: jobId,
        p_name: f.name,
        p_brand: f.brand || null,
        p_categories: f.categories,
      })
      if (error) throw error
      await recordDeviceJob(jobId)
    },
    onSuccess: done,
  })

  return { job, catalog, photoUrl, useExisting, createNew, confirmItem }
}
