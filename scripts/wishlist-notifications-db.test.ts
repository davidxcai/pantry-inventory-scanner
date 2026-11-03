import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest'
const alice='00000000-0000-4000-8000-000000000001'
const bob='00000000-0000-4000-8000-000000000002'
const rice='10000000-0000-4000-8000-000000000001'
const beans='10000000-0000-4000-8000-000000000002'
let db:PGlite
let migrated:{items:number;wishlist:number;pending:number}
async function admin(){await db.exec('reset role')}
async function login(id=alice){await db.exec('reset role;set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])}
async function save(id=rice){await db.query('insert into watchlist_items(user_id,item_id) values(auth.uid(),$1) on conflict do nothing',[id])}
async function status(value:string,id=rice){await admin();await db.query('update items set status=$1 where id=$2',[value,id])}
async function claim(){await admin();return (await db.query<{id:number;user_id:string;claim_token:string;item_id:string}>('select * from claim_notifications(25)')).rows}
async function queue(){await admin();return (await db.query<{id:number;user_id:string;claim_token:string}>('select * from notification_queue where sent_at is null')).rows}
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;
 create function public.is_uta_user() returns boolean language sql stable as $$select auth.uid() is not null$$;
 create table items(id uuid primary key,name text,status text default 'out',status_verified boolean default false,categories text[] default array['snacks']);
 create view available_items as select id,name,status as availability from items where not ('other'=any(categories));
 grant select on available_items to authenticated,anon;
 create table item_status_log(id uuid primary key default gen_random_uuid(),item_id uuid references items(id),user_id uuid references auth.users(id),status text,kind text default 'report',created_at timestamptz default now());
 `)
 await db.exec(readFileSync('supabase/migrations/20261024000000_personal_watchlist.sql','utf8'))
 await db.exec(readFileSync('supabase/migrations/20261101000000_notifications.sql','utf8'))
 await db.exec('grant select,insert,delete on item_subscriptions to authenticated')
 await db.query('insert into auth.users values($1,$3),($2,$4)',[alice,bob,'alice@mavs.uta.edu','bob@mavs.uta.edu'])
 await db.query("insert into items(id,name) values($1,'Rice'),($2,'Beans')",[rice,beans])
 await db.query('insert into item_subscriptions(user_id,item_id) values($1,$2),($1,$3)',[alice,rice,beans])
 await db.query('insert into watchlist_items(user_id,item_id) values($1,$2)',[alice,rice])
 await db.query("insert into notification_queue(user_id,item_id,status,kind) values($1,$2,'out','report')",[alice,rice])
 await db.exec(readFileSync('supabase/migrations/20261102060000_wishlist_availability_emails.sql','utf8'))
 migrated={items:(await db.query('select * from watchlist_items')).rows.length,wishlist:(await db.query('select * from wishlist_items')).rows.length,pending:(await queue()).length}
},30_000)
beforeEach(async()=>{
 await admin();await db.exec('truncate auth.users,items cascade')
 await db.query('insert into auth.users values($1,$3),($2,$4)',[alice,bob,'alice@mavs.uta.edu','bob@mavs.uta.edu'])
 await db.query("insert into items(id,name) values($1,'Rice'),($2,'Beans')",[rice,beans])
 await login();await save();await db.query('select set_wishlist_item($1,true)',[rice]);await login(bob);await save();await db.query('select set_wishlist_item($1,true)',[rice])
})
afterAll(async()=>{await db?.close()})
it('preserves Saved products without automatically subscribing saves or legacy watches',()=>{
 expect(migrated).toEqual({items:1,wishlist:0,pending:0})
})
it('queues only unavailable-to-available transitions, once per wishlist account',async()=>{
 await status('low');expect(await queue()).toHaveLength(2)
 await status('in_stock');await status('in_stock');expect(await queue()).toHaveLength(2)
 await status('out');expect(await queue()).toHaveLength(2)
 await status('in_stock');expect(await queue()).toHaveLength(4)
})
it('does not notify when an available item is saved or a stock-log confirmation repeats',async()=>{
 await status('in_stock');await claim()
 const rows=await queue();
 for(const row of rows as {id:number;claim_token:string}[])await db.query('select finish_wishlist_notifications($1,$2,true)',[[row.id],row.claim_token])
 await login();await save(beans);await admin()
 await db.query("insert into item_status_log(item_id,user_id,status,kind) values($1,$2,'in_stock','confirm')",[rice,alice])
 expect(await queue()).toHaveLength(0)
})
it('drops queued messages when products become unavailable, unlisted, or are removed',async()=>{
 await status('in_stock');await status('out');expect(await claim()).toHaveLength(0)
 await status('in_stock');await login();await db.query('delete from watchlist_items where item_id=$1',[rice])
 expect((await claim()).map(row=>row.user_id)).toEqual([bob])
 await admin();await db.query("update items set categories=array['other'] where id=$1",[rice])
 expect(await claim()).toHaveLength(0)
})
it('pauses only the owner emails and preserves wishlist items, including future subscriptions',async()=>{
 await login();await db.exec('select set_wishlist_email_enabled(false)')
 expect((await db.query<{settings:{enabled:boolean}}>('select get_wishlist_email_settings() as settings')).rows[0].settings.enabled).toBe(false)
 expect((await db.query('select * from watchlist_items')).rows).toHaveLength(1)
 await status('in_stock');expect((await queue()).map(row=>row.user_id)).toEqual([bob])
 await login();await db.exec('select set_wishlist_email_enabled(true)');await status('out');await status('low')
 expect(await queue()).toHaveLength(3)
})
it('protects preferences, queue, and leases against ordinary and anonymous users',async()=>{
 await login()
 await expect(db.exec('select * from wishlist_email_preferences')).rejects.toMatchObject({code:'42501'})
 await expect(db.query('select stop_wishlist_emails($1)',[bob])).rejects.toMatchObject({code:'42501'})
 await expect(db.exec('select * from claim_notifications(25)')).rejects.toMatchObject({code:'42501'})
 await expect(db.query('insert into item_subscriptions(user_id,item_id) values($1,$2)',[alice,beans])).rejects.toMatchObject({code:'42501'})
 await db.exec('reset role;set role anon')
 await expect(db.exec('select set_wishlist_email_enabled(false)')).rejects.toMatchObject({code:'42501'})
})
it('leases claims without marking them sent and retries failures without stale acknowledgements',async()=>{
 await status('in_stock');const rows=await claim();expect(rows).toHaveLength(2)
 expect(await claim()).toHaveLength(0)
 await db.query('select finish_wishlist_notifications($1,$2,false)',[rows.map(row=>row.id),rows[0].claim_token])
 const retried=await claim();expect(retried).toHaveLength(2)
 await db.query('select finish_wishlist_notifications($1,$2,true)',[rows.map(row=>row.id),rows[0].claim_token])
 expect(await queue()).toHaveLength(2)
 await db.query('select finish_wishlist_notifications($1,$2,true)',[retried.map(row=>row.id),retried[0].claim_token])
 expect(await queue()).toHaveLength(0)
})
it('recovers abandoned worker leases and unsubscribes without deleting saves',async()=>{
 await status('in_stock');await claim()
 await db.exec("update notification_queue set claimed_until=now()-interval '1 second'")
 expect(await claim()).toHaveLength(2)
 await db.query('select stop_wishlist_emails($1)',[alice]);await login()
 expect((await db.query('select * from watchlist_items')).rows).toHaveLength(1)
 await status('out');await status('low')
 expect((await queue()).filter(row=>row.user_id===alice)).toHaveLength(1) // existing leased row; no new mail
})

it('saving alone never queues email; only explicit out-of-stock wishlist opt-ins do',async()=>{
 await admin();await db.exec('delete from wishlist_items')
 await status('in_stock');expect(await queue()).toHaveLength(0)
 await status('out');await login();await db.query('select set_wishlist_item($1,true)',[rice]);await status('low')
 expect((await queue()).map(row=>row.user_id)).toEqual([alice])
 await login(bob);expect((await db.query('select * from watchlist_items')).rows).toHaveLength(1)
 expect((await db.query('select * from wishlist_items')).rows).toHaveLength(0)
})
it('requires an out-of-stock saved product and scopes wishlist changes to the owner',async()=>{
 await login()
 await expect(db.query('select set_wishlist_item($1,true)',[beans])).rejects.toThrow('Save this product')
 await save(beans);await status('in_stock',beans);await login()
 await expect(db.query('select set_wishlist_item($1,true)',[beans])).rejects.toThrow('Only out-of-stock')
 await status('out',beans);await login();await db.query('select set_wishlist_item($1,true)',[beans])
 await db.query('select set_wishlist_item($1,true)',[beans])
 expect((await db.query('select * from wishlist_items')).rows).toHaveLength(2)
 await expect(db.query('insert into wishlist_items(user_id,item_id) values($1,$2)',[bob,beans])).rejects.toMatchObject({code:'42501'})
 await login(bob);expect((await db.query('select * from wishlist_items')).rows).toHaveLength(1)
})
it('removing a wishlist entry keeps the product saved and suppresses its pending email',async()=>{
 await status('in_stock');await login();await db.query('select set_wishlist_item($1,false)',[rice])
 expect((await db.query('select * from watchlist_items')).rows).toHaveLength(1)
 expect((await claim()).map(row=>row.user_id)).toEqual([bob])
})
it('removing a saved product cascades only that owners wishlist subscription',async()=>{
 await login();await db.query('delete from watchlist_items where item_id=$1',[rice])
 expect((await db.query('select * from wishlist_items')).rows).toHaveLength(0)
 await login(bob);expect((await db.query('select * from wishlist_items')).rows).toHaveLength(1)
})
