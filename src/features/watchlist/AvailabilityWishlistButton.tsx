import {IconBell,IconBellOff} from '@tabler/icons-react'
import type {CatalogRow} from '../../../shared/catalogView'
import {useAvailabilityWishlist} from './useAvailabilityWishlist'
export function AvailabilityWishlistButton({item,userId,allowAvailableRemoval=false}:{item:CatalogRow;userId:string;allowAvailableRemoval?:boolean}){
  const {query,mutation}=useAvailabilityWishlist(userId)
  const added=query.data?.items.some(row=>row.item_id===item.id)??false
  if(item.availability!=='out'&&(!allowAvailableRemoval||!added))return null
  return <div className="mt-2 flex flex-col gap-1">
    <button type="button" className="btn btn-sm btn-outline w-full" aria-pressed={added}
      aria-label={added?`Remove ${item.name} from wishlist`:`Add ${item.name} to wishlist for an availability email`}
      disabled={query.isPending||!!query.error||mutation.isPending}
      onClick={()=>mutation.mutate({item,enabled:!added})}>
      {added?<IconBellOff size={16} aria-hidden="true"/>:<IconBell size={16} aria-hidden="true"/>}
      {added?'Remove from wishlist':'Add to wishlist'}
    </button>
    {added&&item.availability!=='out'&&<p className="text-xs font-medium text-success">Available now</p>}
    {(query.error||mutation.error)&&<p role="alert" className="text-xs text-error">{(query.error||mutation.error)?.message}</p>}
  </div>
}
