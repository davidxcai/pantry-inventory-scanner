import { recordDeviceStock } from '../points/devicePoints'
import { refreshPoints } from '../points/refreshPoints'
import { requestPhotoAnalysis } from '../../lib/photoApi'
import { uuid } from '../../lib/uuid'
import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Detection } from '../../../shared/shelfScan'

export type ShelfStatus = 'queued' | 'processing' | 'ready' | 'confirmed' | 'red' | 'waiting_quota' | 'rejected'

export type ShelfScan = {
  id: string
  status: ShelfStatus
  detections: Detection[] | null
  reject_reason: string | null
  error: string | null
  photo_path: string
  created_at: string
}

const COLUMNS = 'id, status, detections, reject_reason, error, photo_path, created_at'

// Upload the photo and create the scan, then ask the server to read it without waiting for the
// answer: the result arrives through Realtime and the student is free to leave.
export async function submitShelfScan(photo: Blob): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) throw new Error('Sign in to update stock')

  const id = uuid()
  const photoPath = `${session.user.id}/shelf/${id}.jpg`
  const { error: uploadError } = await supabase.storage.from('intake-photos').upload(photoPath, photo, { contentType: 'image/jpeg', upsert: true })
  if (uploadError) throw uploadError

  const { error } = await supabase.from('shelf_scans').insert({ id, photo_path: photoPath, created_by: session.user.id })
  if (error) throw error

  void requestShelfScan(id).catch(() => {})
  return id
}

// A failure here only leaves the scan "queued"; the banner on the catalog offers a retry.
export const requestShelfScan = (scanId: string) => requestPhotoAnalysis('shelf', scanId)

// Re-fetch when the server changes a scan. Row-level security limits events to the user's own.
function useShelfRealtime(onChange: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const channel = supabase
      .channel(`shelf-scans-${uuid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shelf_scans' }, onChange)
      .subscribe()
    return () => void supabase.removeChannel(channel)
  }, [onChange, enabled])
}

// Scans still waiting for the student: in progress, ready to verify, or failed. Last 24 hours.
export function useOpenShelfScans(enabled: boolean) {
  const queryClient = useQueryClient()
  const key = ['shelf-scans']
  useShelfRealtime(() => void queryClient.invalidateQueries({ queryKey: key }), enabled)
  return useQuery({
    queryKey: key,
    enabled,
    queryFn: async (): Promise<ShelfScan[]> => {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const { data, error } = await supabase
        .from('shelf_scans')
        .select(COLUMNS)
        .neq('status', 'confirmed')
        .gt('created_at', since)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as ShelfScan[]
    },
    refetchInterval: 10_000,
  })
}

export function useShelfScan(scanId: string) {
  const queryClient = useQueryClient()
  const key = ['shelf-scan', scanId]
  useShelfRealtime(() => void queryClient.invalidateQueries({ queryKey: key }))
  return useQuery({
    queryKey: key,
    queryFn: async (): Promise<ShelfScan> => {
      const { data, error } = await supabase.from('shelf_scans').select(COLUMNS).eq('id', scanId).single()
      if (error) throw error
      return data as unknown as ShelfScan
    },
    refetchInterval: (q) => (q.state.data && ['queued', 'processing'].includes(q.state.data.status) ? 4_000 : false),
  })
}

// The shelf photo lives in the private bucket, so it is shown through a short-lived signed link.
export function useShelfPhotoUrl(photoPath: string | undefined) {
  return useQuery({
    queryKey: ['shelf-photo', photoPath],
    enabled: !!photoPath,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('intake-photos').createSignedUrl(photoPath!, 3600)
      if (error) throw error
      return data.signedUrl
    },
  })
}

export type ConfirmResult = { updated: number; skipped: { item_id: string; reason: string }[]; devicePoints?: number }

export function useConfirmShelfScan(scanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (itemIds: string[]): Promise<ConfirmResult> => {
      const { data, error } = await supabase.rpc('confirm_shelf_scan', { p_scan_id: scanId, p_item_ids: itemIds })
      if (error) throw error
      const result = data as ConfirmResult
      const savedIds = itemIds.filter(id => !result.skipped.some(entry => entry.item_id === id))
      const feedback = await recordDeviceStock(savedIds, `scan:${scanId}`)
      return { ...result, ...(feedback ? { devicePoints: feedback.filter(entry => entry.outcome === 'earned').length } : {}) }
    },
    onSuccess: () => {
      void refreshPoints(queryClient)
      void queryClient.invalidateQueries({ queryKey: ['public-catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['shelf-scans'] })
      void queryClient.invalidateQueries({ queryKey: ['shelf-scan', scanId] })
    },
  })
}
