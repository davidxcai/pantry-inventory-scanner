import type { SavedItem } from './watchlistStorage'
const key = (userId: string) => `pantry:availability-wishlist:v1:${import.meta.env.VITE_SUPABASE_URL ?? 'local'}:${userId}`
export function readAvailabilityWishlist(userId: string): SavedItem[] {
  if(typeof localStorage==='undefined') return []
  const value:unknown=JSON.parse(localStorage.getItem(key(userId))??'[]')
  if(!Array.isArray(value)||!value.every(row=>row&&typeof row.item_id==='string'&&typeof row.created_at==='string')) throw new Error('Could not read your wishlist on this device.')
  return value
}
export function storeAvailabilityWishlist(userId: string,itemId: string,enabled: boolean) {
  const previous=readAvailabilityWishlist(userId)
  if(!enabled&&!previous.some(row=>row.item_id===itemId))return
  const next=previous.filter(row=>row.item_id!==itemId)
  if(enabled) next.unshift(previous.find(row=>row.item_id===itemId)??{item_id:itemId,created_at:new Date().toISOString()})
  if(typeof localStorage==='undefined') throw new Error('Allow site storage to save your wishlist on this device.')
  localStorage.setItem(key(userId),JSON.stringify(next))
}
