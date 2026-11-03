import {setWatchlistItem} from './watchlistData'
import type { CatalogRow } from '../../../shared/catalogView'
import { supabase } from '../../lib/supabase'
import type { SavedItem } from './watchlistStorage'
import { readAvailabilityWishlist,storeAvailabilityWishlist } from './availabilityWishlistStorage'
export type AvailabilityWishlistState={items:SavedItem[];deviceOnly:boolean}
const missing=(error:{code?:string})=>['PGRST202','PGRST205','42883','42P01'].includes(error.code??'')
async function accountItems(userId:string) {
  const items:SavedItem[]=[]
  for(let offset=0;;offset+=1000){
    const result=await supabase.from('wishlist_items').select('item_id,created_at').eq('user_id',userId).order('created_at',{ascending:false}).order('item_id').range(offset,offset+999)
    if(result.error)throw result.error
    items.push(...result.data)
    if(result.data.length<1000)return items
  }
}
const tasks=new Map<string,Promise<unknown>>()
function serial<T>(userId:string,action:()=>Promise<T>):Promise<T>{
  const result=(tasks.get(userId)??Promise.resolve()).catch(()=>{}).then(action)
  tasks.set(userId,result)
  void result.finally(()=>{if(tasks.get(userId)===result)tasks.delete(userId)}).catch(()=>{})
  return result
}
export function loadAvailabilityWishlist(userId:string):Promise<AvailabilityWishlistState>{
  if(!userId)return Promise.reject(new Error('Sign in to view your wishlist.'))
  return serial(userId,async()=>{
    let saved:SavedItem[]
    try{saved=await accountItems(userId)}catch(error){
      if(error&&typeof error==='object'&&missing(error))return {items:readAvailabilityWishlist(userId),deviceOnly:true}
      throw error
    }
    let synced=false
    for(const entry of readAvailabilityWishlist(userId)){
      // A device choice made while out of stock cannot be backdated into a server subscription.
      const result=await supabase.rpc('set_wishlist_item',{p_item_id:entry.item_id,p_enabled:true})
      if(result.error){
        if(missing(result.error)||result.error.code==='P0001')continue
        throw result.error
      }
      storeAvailabilityWishlist(userId,entry.item_id,false);synced=true
    }
    if(synced)saved=await accountItems(userId)
    const local=readAvailabilityWishlist(userId)
    const merged=new Map(local.map(row=>[row.item_id,row]))
    for(const row of saved)merged.set(row.item_id,row)
    return {items:[...merged.values()],deviceOnly:local.length>0}
  })
}
export function setAvailabilityWishlist(userId:string,item:CatalogRow,enabled:boolean,saveIfNeeded=false){
  if(!userId)return Promise.reject(new Error('Sign in to update your wishlist.'))
  return serial(userId,async()=>{
    if(enabled&&item.availability!=='out')throw new Error('Only out-of-stock saved products can be added to the wishlist.')
    if(enabled&&saveIfNeeded)await setWatchlistItem(userId,item.id,true)
    const {error}=await supabase.rpc('set_wishlist_item',{p_item_id:item.id,p_enabled:enabled})
    if(error){
      if(!missing(error))throw new Error(error.message)
      storeAvailabilityWishlist(userId,item.id,enabled);return
    }
    storeAvailabilityWishlist(userId,item.id,false)
  })
}
