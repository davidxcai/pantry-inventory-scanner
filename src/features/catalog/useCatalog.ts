import { recordDeviceStock } from '../points/devicePoints'
import { refreshPoints } from '../points/refreshPoints'
import { uuid } from '../../lib/uuid'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { CatalogRow, PublicAvailability } from '../../../shared/catalogView'
import { HISTORY_KEY } from './useItemHistory'

const KEY = ['public-catalog']
export const CATALOG_COLUMNS = 'id, name, category, thumbnail_path, availability, updated_at, updated_by_name, pending, reported_by_me'

export const thumbUrl = (path: string | null) =>
  path ? supabase.storage.from('thumbnails').getPublicUrl(path).data.publicUrl : undefined

// The public view: availability, last update time and who made it. Works without login.
export function useCatalog() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CatalogRow[]> => {
      const { data, error } = await supabase
        .from('available_items')
        .select(CATALOG_COLUMNS)
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
      await recordDeviceStock([itemId], `report:${uuid()}`)
    },
    onSuccess: () => {
      void refreshPoints(queryClient)
      queryClient.invalidateQueries({ queryKey: KEY })
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
      queryClient.invalidateQueries({ queryKey: ['personal-watchlist'] })
    },
  })
}
