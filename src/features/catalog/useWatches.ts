import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const KEY = ['my-watches']

export type Watch = { item_id: string; created_at: string; changed: boolean }

// Items the signed-in user watches. changed = someone else updated it since they last opened the watching list.
export function useWatches(enabled: boolean) {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Watch[]> => {
      const { data, error } = await supabase.rpc('my_watches')
      if (error) throw error
      return data as Watch[]
    },
    enabled,
    refetchInterval: 60_000,
  })
}

export function useToggleWatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ itemId, watch }: { itemId: string; watch: boolean }) => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) throw new Error('Sign in to get notified')
      const { error } = watch
        ? await supabase.from('item_subscriptions').insert({ user_id: data.user.id, item_id: itemId })
        : await supabase.from('item_subscriptions').delete().eq('item_id', itemId).eq('user_id', data.user.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}

// Clears the "changed" flags. Call after the user has seen the list.
export function useMarkWatchesSeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_watches_seen')
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
