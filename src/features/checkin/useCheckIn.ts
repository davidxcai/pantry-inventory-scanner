import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Uses the monthly allowance first, then a single approved extra visit.
// Repeated scans inside the active 30-minute session do not consume another visit.
export function useCheckIn() {
  const client = useQueryClient()
  return useMutation({
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['inventory-points'] }) },
    mutationFn: async (code: string): Promise<Date> => {
      const { data, error } = await supabase.rpc('check_in', { p_code: code })
      if (error) throw error
      return new Date(data as string)
    },
  })
}
