import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import type {VercelRequest,VercelResponse} from '@vercel/node'
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),getUserById:vi.fn(),send:vi.fn()}))
vi.mock('../api/_lib/clients',()=>({admin:{rpc:mock.rpc,from:mock.from,auth:{admin:{getUserById:mock.getUserById}}}}))
vi.mock('../api/_lib/sendEmail',()=>({APP_URL:'https://pantry.test',sendEmail:mock.send}))
import notify from '../api/notify'
import unsubscribe from '../api/unsubscribe'
import {unsubscribeToken} from '../shared/notifyDigest'
const queued={id:1,user_id:'owner',item_id:'rice',item_name:'Rice',status:'in_stock',kind:'report',created_at:'2026-11-02T18:00:00Z',claim_token:'lease'}
let enabled=true
let saved=true
let available=true
const response=()=>({status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis(),send:vi.fn().mockReturnThis(),setHeader:vi.fn()})
const request=(method='POST',authorization='Bearer cron')=>({method,headers:{authorization},query:{}} as unknown as VercelRequest)
beforeEach(()=>{
 vi.clearAllMocks();enabled=true;saved=true;available=true
 vi.stubEnv('CRON_SECRET','cron');vi.stubEnv('SUPABASE_SECRET_KEY','test-secret')
 mock.rpc.mockImplementation(async(name:string)=>({data:name==='claim_notifications'?[queued]:null,error:null}))
 mock.getUserById.mockResolvedValue({data:{user:{email:'current-login@mavs.uta.edu',email_confirmed_at:'2026-11-02T00:00:00Z'}},error:null})
 mock.send.mockResolvedValue('sent')
 mock.from.mockImplementation((table:string)=>({select:()=>{
   const builder={limit:async()=>({data:[],error:null}),eq:()=>builder,maybeSingle:async()=>({data:{enabled},error:null}),in:async()=>({data:table==='wishlist_items'?(saved?[{item_id:'rice'}]:[]):(available?[{id:'rice',name:'Rice',availability:'in_stock',pending:true}]:[]),error:null})}
   return builder
 }}))
})
afterEach(()=>vi.unstubAllEnvs())
it('sends availability mail only to the current verified login email with a Wishlist link',async()=>{
 const res=response();await notify(request(),res as unknown as VercelResponse)
 expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({to:'current-login@mavs.uta.edu',text:expect.stringContaining('https://pantry.test/profile?list=wishlist')}))
 expect(mock.send.mock.calls[0][0].text).toContain('Products on your Thyme Saver wishlist are available')
 expect(mock.rpc).toHaveBeenCalledWith('finish_wishlist_notifications',{p_ids:[1],p_claim_token:'lease',p_sent:true})
 expect(res.json).toHaveBeenCalledWith(expect.objectContaining({sent:1}))
})
it('does not email unverified accounts and releases the lease for retry',async()=>{
 mock.getUserById.mockResolvedValue({data:{user:{email:'unconfirmed@mavs.uta.edu',email_confirmed_at:null}},error:null})
 const res=response();await notify(request(),res as unknown as VercelResponse)
 expect(mock.send).not.toHaveBeenCalled()
 expect(mock.rpc).toHaveBeenCalledWith('finish_wishlist_notifications',expect.objectContaining({p_sent:false}))
 expect(res.json).toHaveBeenCalledWith(expect.objectContaining({failed:1}))
})
it.each(['paused','removed','unavailable'])('skips %s items that changed after the claim',async(reason)=>{
 if(reason==='paused')enabled=false
 if(reason==='removed')saved=false
 if(reason==='unavailable')available=false
 const res=response();await notify(request(),res as unknown as VercelResponse)
 expect(mock.send).not.toHaveBeenCalled()
 expect(mock.rpc).toHaveBeenCalledWith('finish_wishlist_notifications',expect.objectContaining({p_sent:true}))
 expect(res.json).toHaveBeenCalledWith(expect.objectContaining({skipped:1}))
})
it('retains failed and rate-limited deliveries for retry',async()=>{
 for(const mode of ['failure','limit']){
   mock.rpc.mockClear()
   if(mode==='failure')mock.send.mockRejectedValue(new Error('Provider failed'))
   else mock.send.mockResolvedValue('limited')
   await notify(request(),response() as unknown as VercelResponse)
   expect(mock.rpc).toHaveBeenCalledWith('finish_wishlist_notifications',expect.objectContaining({p_sent:false}))
 }
})
it('rejects unauthorized requests before reading account data',async()=>{
 const res=response();await notify(request('GET','Bearer wrong'),res as unknown as VercelResponse)
 expect(res.status).toHaveBeenCalledWith(401)
 expect(mock.rpc).not.toHaveBeenCalled()
})
it('unsubscribe GET is read-only; signed POST pauses email without deleting wishlist items',async()=>{
 const token=await unsubscribeToken('test-secret','owner')
 const req={...request('GET'),query:{t:token}} as unknown as VercelRequest
 const get=response();await unsubscribe(req,get as unknown as VercelResponse)
 expect(mock.rpc).not.toHaveBeenCalled()
 expect(get.send).toHaveBeenCalledWith(expect.stringContaining('wishlist items will stay saved'))
 const post=response();await unsubscribe({...req,method:'POST'} as VercelRequest,post as unknown as VercelResponse)
 expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('stop_wishlist_emails',{p_user_id:'owner'})
 expect(mock.from).not.toHaveBeenCalled()
})
it('rejects invalid unsubscribe signatures without changes',async()=>{
 const res=response();await unsubscribe({...request(),query:{t:'owner.invalid'}} as unknown as VercelRequest,res as unknown as VercelResponse)
 expect(res.status).toHaveBeenCalledWith(400)
 expect(mock.rpc).not.toHaveBeenCalled()
})

it('refuses the legacy queue before claiming any rows when the migration is absent',async()=>{
 mock.from.mockReturnValue({select:()=>({limit:async()=>({data:null,error:{code:'42703'}})})})
 const res=response();await notify(request(),res as unknown as VercelResponse)
 expect(res.status).toHaveBeenCalledWith(503)
 expect(mock.rpc).not.toHaveBeenCalled()
 expect(mock.send).not.toHaveBeenCalled()
})
