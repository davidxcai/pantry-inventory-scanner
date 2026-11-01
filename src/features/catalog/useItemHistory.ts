import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { PublicAvailability } from '../../../shared/catalogView'

export const HISTORY_KEY = ['item-history']

// display_name survives account deletion (copied into the log); null only for rows with no updater.
export type HistoryEntry = {
  status: PublicAvailability
  kind: 'report' | 'confirm'
  display_name: string | null
  created_at: string
}

// The latest updates to one item, newest first. Public, like the catalog.
export function useItemHistory(itemId: string, limit = 5) {
  return useQuery({
    queryKey: [...HISTORY_KEY, itemId, limit],
    queryFn: async (): Promise<HistoryEntry[]> => {
      const { data, error } = await supabase.rpc('item_history', { p_item_id: itemId, p_limit: limit })
      if (error) throw error
      return data as HistoryEntry[]
    },
  })
}
