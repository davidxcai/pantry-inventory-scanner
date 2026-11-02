import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { CatalogRow, PublicAvailability } from '../../../shared/catalogView'
import { HISTORY_KEY } from './useItemHistory'

const KEY = ['public-catalog']

export const thumbUrl = (path: string | null) =>
  path ? supabase.storage.from('thumbnails').getPublicUrl(path).data.publicUrl : undefined

// The public view: availability, last update time and who made it. Works without login.
export function useCatalog() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CatalogRow[]> => {
      const { data, error } = await supabase
        .from('available_items')
        .select('id, name, category, thumbnail_path, availability, updated_at, updated_by_name, pending, reported_by_me')
        .limit(5000)
      if (error) throw error
      return data as CatalogRow[]
    },
    refetchInterval: 30_000,
  })
}

// Signed-in UTA users only; enforced by the set_item_status database function.
export function useSetStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, status }: { itemId: string; status: PublicAvailability }) => {
      const { error } = await supabase.rpc('set_item_status', { p_item_id: itemId, p_status: status })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY })
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
    },
  })
}
