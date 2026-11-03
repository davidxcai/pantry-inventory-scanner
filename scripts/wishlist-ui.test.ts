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
 expect(renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:rice,userId:'student'}))).toContain('Add to wishlist')
 for(const availability of ['in_stock','low'] as const){
   expect(renderToStaticMarkup(createElement(AvailabilityWishlistButton,{item:{...rice,availability},userId:'student'}))).toBe('')
 }
 expect(renderToStaticMarkup(createElement(WatchlistButton,{itemId:'rice',name:'Rice',userId:'student'}))).toContain('>Save</button>')
})
it('shows the login email and email preference only inside the Wishlist view',()=>{
 const html=renderToStaticMarkup(createElement(ProfileScreen,{initialTab:'wishlist'}))
 expect(html).toContain('Alerts go to login@mavs.uta.edu, your login email.')
 expect(html).toContain('Saving a product alone does not subscribe you to emails')
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
it('reports device-only email limits without disabling saved-product organization',()=>{
 mock.emails.mockReturnValue({query:{data:{ready:false,enabled:false}},mutation:{}})
 const html=renderToStaticMarkup(createElement(ProfileScreen,{initialTab:'wishlist'}))
 expect(html).toContain('Email alerts need server setup')
 expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/)
 expect(html).toContain('Browse items')
})
