import type { QueryClient } from '@tanstack/react-query'
export const refreshPoints = (client: QueryClient) => Promise.all([
  client.invalidateQueries({ queryKey: ['inventory-points'] }),
  client.invalidateQueries({ queryKey: ['inventory-point-activity'] }),
])
