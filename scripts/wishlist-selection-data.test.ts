import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import type {CatalogRow} from '../shared/catalogView'
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:mock.from}}))
import {setAvailabilityWishlist,loadAvailabilityWishlist} from '../src/features/watchlist/availabilityWishlistData'
import {readAvailabilityWishlist} from '../src/features/watchlist/availabilityWishlistStorage'
import {setWatchlistItem} from '../src/features/watchlist/watchlistData'
import {readDeviceSaves} from '../src/features/watchlist/watchlistStorage'
const out:CatalogRow={id:'rice',name:'Rice',availability:'out',category:'snacks',thumbnail_path:null,pending:false,reported_by_me:false,updated_at:null,updated_by_name:null}
beforeEach(()=>{
 vi.clearAllMocks()
 const data=new Map<string,string>()
 vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}})
 mock.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}})
 mock.from.mockImplementation(()=>{
  const builder={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),delete:vi.fn().mockReturnThis(),range:async()=>({data:null,error:{code:'PGRST205'}}),upsert:async()=>({error:{code:'PGRST205'}}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({error:{code:'PGRST205'}}).then(resolve)}
  return builder
 })
})
afterEach(()=>vi.unstubAllGlobals())
it('saving a product does not opt it into wishlist email alerts',async()=>{
 await setWatchlistItem('alice','rice',true)
 expect(readDeviceSaves('alice')).toHaveLength(1)
 expect(readAvailabilityWishlist('alice')).toEqual([])
 expect(mock.rpc).not.toHaveBeenCalled()
})
it('stores a separate explicit wishlist choice, scoped to the signed-in account',async()=>{
 await setWatchlistItem('alice','rice',true)
 await setAvailabilityWishlist('alice',out,true)
 await setAvailabilityWishlist('alice',out,true)
 expect((await loadAvailabilityWishlist('alice')).items).toHaveLength(1)
 expect(readDeviceSaves('alice')).toHaveLength(1)
 expect((await loadAvailabilityWishlist('bob')).items).toEqual([])
})
it('rejects available products before any request and surfaces server eligibility rejections',async()=>{
 await expect(setAvailabilityWishlist('alice',{...out,availability:'in_stock'},true)).rejects.toThrow('out-of-stock')
 expect(mock.rpc).not.toHaveBeenCalled()
 mock.rpc.mockResolvedValue({error:{code:'P0001',message:'Save this product before adding it to your wishlist'}})
 await expect(setAvailabilityWishlist('alice',out,true)).rejects.toThrow('Save this product')
 expect(readAvailabilityWishlist('alice')).toEqual([])
})
it('removing from wishlist preserves the saved product; unsaving clears the local wishlist choice',async()=>{
 await setWatchlistItem('alice','rice',true);await setAvailabilityWishlist('alice',out,true)
 await setAvailabilityWishlist('alice',{...out,availability:'low'},false)
 expect(readDeviceSaves('alice')).toHaveLength(1)
 expect(readAvailabilityWishlist('alice')).toEqual([])
 await setAvailabilityWishlist('alice',out,true)
 await setWatchlistItem('alice','rice',false)
 expect(readDeviceSaves('alice')).toEqual([])
 expect(readAvailabilityWishlist('alice')).toEqual([])
})
it('does not treat a network failure as a successful wishlist change',async()=>{
 mock.rpc.mockResolvedValue({error:{code:'NETWORK',message:'Connection lost'}})
 await expect(setAvailabilityWishlist('alice',out,true)).rejects.toThrow('Connection lost')
 expect(readAvailabilityWishlist('alice')).toEqual([])
})

it('homepage wishlist enrollment saves the out-of-stock product first and keeps choices in both lists',async()=>{
 await setAvailabilityWishlist('alice',out,true,true)
 expect(readDeviceSaves('alice').map(row=>row.item_id)).toEqual(['rice'])
 expect(readAvailabilityWishlist('alice').map(row=>row.item_id)).toEqual(['rice'])
 await setAvailabilityWishlist('alice',out,false,true)
 expect(readDeviceSaves('alice')).toHaveLength(1)
 expect(readAvailabilityWishlist('alice')).toEqual([])
})
it('never auto-saves available products while rejecting a homepage wishlist request',async()=>{
 await expect(setAvailabilityWishlist('alice',{...out,availability:'low'},true,true)).rejects.toThrow('out-of-stock')
 expect(readDeviceSaves('alice')).toEqual([])
 expect(mock.from).not.toHaveBeenCalled()
})
