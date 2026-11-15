import {createElement,type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach,it,expect,vi} from 'vitest'
import type {CatalogRow} from '../shared/catalogView'
const mock=vi.hoisted(()=>({saved:vi.fn(),emails:vi.fn(),wishlist:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{}}))
vi.mock('../src/features/auth/useSession',()=>({useSession:()=>({user:{id:'student',email:'login@mavs.uta.edu'}}),displayNameOf:()=> 'Student'}))
vi.mock('../src/features/watchlist/useWatchlist',()=>({useWatchlist:mock.saved,useSetWatchlistItem:()=>({isPending:false,mutate:vi.fn()})}))
vi.mock('../src/features/watchlist/useWishlistEmails',()=>({useWishlistEmails:mock.emails}))
vi.mock('../src/features/watchlist/useAvailabilityWishlist',()=>({useAvailabilityWishlist:mock.wishlist}))
vi.mock('../src/features/catalog/ItemDialog',()=>({ItemDialog:()=>null}))
vi.mock('../src/features/catalog/useCatalog',()=>({thumbUrl:()=>undefined}))
vi.mock('@tanstack/react-router',()=>({Link:({to,children}:{to:string;children:ReactNode})=>createElement('a',{href:to},children)}))
import {ProfileScreen} from '../src/features/profile/ProfileScreen'
import {Navbar} from '../src/features/auth/Navbar'
import {WatchlistButton} from '../src/features/watchlist/WatchlistButton'
import {AvailabilityWishlistButton} from '../src/features/watchlist/AvailabilityWishlistButton'
import {ItemCard} from '../src/features/catalog/ItemCard'
const rice:CatalogRow={id:'rice',name:'Rice',category:'snacks',thumbnail_path:null,availability:'out',updated_at:null,updated_by_name:null}
beforeEach(()=>{
 mock.saved.mockReturnValue({data:[],deviceOnly:false,isPending:false,isSuccess:true,isFetching:false,refetch:vi.fn()})
 mock.wishlist.mockReturnValue({query:{data:{items:[],deviceOnly:false},isSuccess:true,isPending:false,refetch:vi.fn()},mutation:{isPending:false,mutate:vi.fn()}})
 mock.emails.mockReturnValue({query:{data:{ready:true,enabled:true},isPending:false,isError:false},mutation:{isPending:false,mutate:vi.fn()}})
})
it('keeps Saved products navigation and places Wishlist only inside that page',()=>{
 const nav=renderToStaticMarkup(createElement(Navbar))
 expect(nav.match(/href="\/profile"/g)).toHaveLength(2)
 expect(nav).not.toContain('Watching')
 expect(nav).not.toContain('href="/wishlist"')
 const page=renderToStaticMarkup(createElement(ProfileScreen))
 expect(page).toContain('>Saved products</h1>')
 expect(page).toContain('role="tab"')
 expect(page).toContain('Wishlist (0)')
 expect(page).not.toContain('Availability alerts go to')
})
it('offers Wishlist only for out-of-stock items, while preserving Save/Saved controls',()=>{
 expect(renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:rice,userId:'student'}))).toContain('Add to Wishlist')
 for(const availability of ['in_stock','low'] as const){
   expect(renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:{...rice,availability},userId:'student'}))).toBe('')
 }
 expect(renderToStaticMarkup(createElement(WatchlistButton,{itemId:'rice',name:'Rice',userId:'student'}))).toContain('>Save</button>')
})

it('offers wishlist enrollment directly on out-of-stock catalog cards',()=>{
 const render=(item:CatalogRow,userId:string|undefined='student')=>renderToStaticMarkup(createElement(ItemCard,{item,userId,onOpen:()=>{}}))
 const out=render(rice)
 expect(out).toContain('Add to Wishlist')
 expect(out).not.toContain('>Save</button>')
 expect(out).not.toContain('Manage email alerts')
 for(const availability of ['in_stock','low'] as const){
   const available=render({...rice,availability})
   expect(available).toContain('>Save</button>')
   expect(available).not.toContain('Add to Wishlist')
 }
 const guest=renderToStaticMarkup(createElement(ItemCard,{item:rice,onOpen:()=>{}}))
 expect(guest).not.toContain('Add to Wishlist')
 expect(guest).not.toContain('Sign in to save')
})

it('shows the active wishlist state on enrolled catalog cards',()=>{
 mock.wishlist.mockReturnValue({query:{data:{items:[{item_id:'rice'}]}},mutation:{}})
 const html=renderToStaticMarkup(createElement(ItemCard,{item:rice,userId:'student',onOpen:()=>{}}))
 expect(html).toContain('Wishlisted')
 expect(html).toContain('aria-pressed="true"')
 expect(html).toContain('Remove Rice from wishlist')
 expect(html).not.toContain('>Save</button>')
})
it('shows the login email and email preference only inside the Wishlist view',()=>{
 const html=renderToStaticMarkup(createElement(ProfileScreen,{initialTab:'wishlist'}))
 expect(html).toContain('Alerts go to login@mavs.uta.edu, your login email.')
 expect(html).not.toContain('About saved products and email alerts')
 expect(html).not.toContain('type="email"')
})
it('filters Wishlist independently from all saved products',()=>{
 mock.saved.mockReturnValue({data:[{item_id:'rice',item:rice},{item_id:'beans',item:{...rice,id:'beans',name:'Beans'}}],isSuccess:true})
 mock.wishlist.mockReturnValue({query:{data:{items:[{item_id:'rice'}]},isSuccess:true},mutation:{}})
 const html=renderToStaticMarkup(createElement(ProfileScreen,{initialTab:'wishlist'}))
 expect(html).toContain('>Rice</h2>')
 expect(html).not.toContain('>Beans</h2>')
 expect(html).toContain('Saved products (2)')
 expect(html).toContain('Wishlist (1)')
})
it('keeps a previously wishlisted product visible after restock, with a removable choice',()=>{
 mock.wishlist.mockReturnValue({query:{data:{items:[{item_id:'rice'}]}},mutation:{}})
 for(const availability of ['in_stock','low'] as const){
   expect(renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:{...rice,availability},userId:'student'}))).toBe('')
 }
 const html=renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:{...rice,availability:'in_stock'},userId:'student',allowAvailableRemoval:true}))
 expect(html).toContain('Remove from wishlist')
 expect(html).toContain('Available now')
})
it('keeps setup and sync descriptions hidden without disabling saved-product organization',()=>{
 mock.emails.mockReturnValue({query:{data:{ready:false,enabled:false}},mutation:{}})
 const html=renderToStaticMarkup(createElement(ProfileScreen,{initialTab:'wishlist'}))
 expect(html).not.toContain('Email alerts need server setup')
 expect(html).not.toContain('We email you when a wishlisted product')
 expect(html).not.toContain('Some wishlist choices are saved on this device')
 expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/)
 expect(html).toContain('Browse items')
})

it('explains active alerts next to a wishlisted product',()=>{
 mock.wishlist.mockReturnValue({query:{data:{items:[{item_id:'rice'}],deviceOnly:false}},mutation:{}})
 const html=renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:rice,userId:'student'}))
 expect(html).toContain('Email alerts are on')
 expect(html).toContain('Manage email alerts')
 expect(html).toContain('email your login address')
})
it('does not promise delivery for a device-only wishlist or paused preference',()=>{
 mock.wishlist.mockReturnValue({query:{data:{items:[{item_id:'rice'}],deviceOnly:true}},mutation:{}})
 const local=renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:rice,userId:'student'}))
 expect(local).toContain('Email alerts start after it syncs')
 expect(local).not.toContain('Email alerts are on')
 mock.wishlist.mockReturnValue({query:{data:{items:[{item_id:'rice'}],deviceOnly:false}},mutation:{}})
 mock.emails.mockReturnValue({query:{data:{ready:true,enabled:false}},mutation:{}})
 const paused=renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:rice,userId:'student'}))
 expect(paused).toContain('Email alerts are paused')
 expect(paused).not.toContain('Email alerts are on')
})
it('shows the recipient without the removed help section or descriptions',()=>{
 const html=renderToStaticMarkup(createElement(ProfileScreen,{initialTab:'wishlist'}))
 expect(html).toContain('Alerts go to login@mavs.uta.edu')
 expect(html).not.toContain('<details')
 expect(html).not.toContain('out of stock to in stock or low stock')
})
