import { useEffect } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CatalogRow } from '../../../shared/catalogView'
import type { SavedProduct } from '../../../shared/savedProducts'
import { loadWatchlistState, setWatchlistItem, type WatchlistState } from './watchlistData'
import { watchlistStorageKey } from './watchlistStorage'

const key = (userId: string | undefined) => ['personal-watchlist', userId] as const

export function useWatchlist(userId: string | undefined) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: key(userId),
    enabled: !!userId,
    queryFn: () => loadWatchlistState(userId ?? ''),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  useEffect(() => {
    if (!userId) return
    const refresh = () => void queryClient.invalidateQueries({ queryKey: key(userId) }, { cancelRefetch: false })
    const changed = (event: StorageEvent) => { if (event.key === watchlistStorageKey(userId)) refresh() }
    window.addEventListener('storage', changed)
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener('storage', changed); window.removeEventListener('online', refresh) }
  }, [queryClient, userId])
  return { ...query, data: query.data?.items, deviceOnly: query.data?.deviceOnly ?? false }
}

export function useSetWatchlistItem(userId: string | undefined, itemId: string, item?: CatalogRow) {
  const queryClient = useQueryClient()
  const mutationKey = ['set-watchlist-item', userId, itemId]
  const pending = useIsMutating({ mutationKey }) > 0
  const mutation = useMutation({
    mutationKey,
    mutationFn: ({ saved }: { saved: boolean }) => setWatchlistItem(userId ?? '', itemId, saved),
    onMutate: async ({ saved }) => {
      await queryClient.cancelQueries({ queryKey: key(userId) })
      const previous = queryClient.getQueryData<WatchlistState>(key(userId))
      const entry = previous?.items.find((product) => product.item_id === itemId)
      const next: SavedProduct = entry ?? { item_id: itemId, created_at: new Date().toISOString(), item: item ?? null }
      queryClient.setQueryData<WatchlistState>(key(userId), (current) => ({
        deviceOnly: current?.deviceOnly ?? false,
        items: saved ? [next, ...(current?.items ?? []).filter((product) => product.item_id !== itemId)]
          : (current?.items ?? []).filter((product) => product.item_id !== itemId),
      }))
      return { entry }
    },
    onError: (_error, _variables, context) => {
      // Roll back only this product, preserving simultaneous saves of other products.
      queryClient.setQueryData<WatchlistState>(key(userId), (current) => {
        if (!current) return current
        const rest = current.items.filter((product) => product.item_id !== itemId)
        return { ...current, items: context?.entry ? [...rest, context.entry].sort((a, b) => b.created_at.localeCompare(a.created_at)) : rest }
      })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key(userId) }),
  })
  return { ...mutation, isPending: mutation.isPending || pending }
}
