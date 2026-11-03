export type SavedItem = { item_id: string; created_at: string }
const prefix = 'pantry:saved-products:v1:'
export const watchlistStorageKey = (userId: string) => `${prefix}${userId}`

// Only unsynced saves live here. Account-owned keys keep lists separate on shared devices.
export function readDeviceSaves(userId: string): SavedItem[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(watchlistStorageKey(userId))
  if (!raw) return []
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || !value.every((entry) => entry && typeof entry.item_id === 'string' && typeof entry.created_at === 'string')) {
    throw new Error('Could not read saved products on this device.')
  }
  return value as SavedItem[]
}

export function setDeviceSave(userId: string, itemId: string, saved: boolean, createdAt = new Date().toISOString()): void {
  const entries = readDeviceSaves(userId)
  const existing = entries.find((entry) => entry.item_id === itemId)
  if (!saved && !existing) return
  const next = entries.filter((entry) => entry.item_id !== itemId)
  if (saved) next.unshift(existing ?? { item_id: itemId, created_at: createdAt })
  try {
    if (typeof localStorage === 'undefined') throw new Error('Device storage unavailable')
    localStorage.setItem(watchlistStorageKey(userId), JSON.stringify(next))
  } catch {
    throw new Error('Could not save on this device. Allow site storage or free some space, then try again.')
  }
}
