// Availability digests for Wishlist. Scheduled by the existing protected notification cron.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { admin } from './_lib/clients.js'
import { APP_URL, sendEmail } from './_lib/sendEmail.js'
import { groupDigests, renderDigest, unsubscribeToken, type QueuedNotification } from '../shared/notifyDigest.js'
export const config = { maxDuration: 60 }
const USERS_PER_RUN = 25

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET','POST'].includes(req.method || '')) return res.status(405).json({error:'GET or POST only'})
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({error:'unauthorized'})
  const schema = await admin.from('notification_queue').select('claim_token').limit(0)
  if (schema.error) return res.status(503).json({error:'Apply the wishlist notification migration before running this sender'})
  const {data,error} = await admin.rpc('claim_notifications',{p_users:USERS_PER_RUN})
  if(error) return res.status(500).json({error:'Could not claim wishlist notifications'})
  const digests = groupDigests(data as QueuedNotification[])
  const outcomes = {sent:0,failed:0,limited:0,skipped:0}
  const started=Date.now()
  let limited=false
  for(const digest of digests) {
    // Older queue schemas have no lease tokens. Never pretend such rows were delivered.
    if(!digest.claimToken) return res.status(503).json({error:'Apply the wishlist notification migration before running this sender'})
    let delivered=false
    try {
      if(limited || Date.now()-started>40_000) {outcomes.limited++;continue}
      const {data:account,error:accountError}=await admin.auth.admin.getUserById(digest.userId)
      // Recipient comes only from the account used for login, never from a request body or profile.
      if(accountError || !account.user?.email || !account.user.email_confirmed_at) throw new Error('Verified login email unavailable')
      const preference=await admin.from('wishlist_email_preferences').select('enabled').eq('user_id',digest.userId).maybeSingle()
      if(preference.error) throw preference.error
      if(preference.data?.enabled===false) {delivered=true;outcomes.skipped++;continue}
      const saved=await admin.from('wishlist_items').select('item_id').eq('user_id',digest.userId).in('item_id',digest.items.map(item=>item.itemId))
      if(saved.error) throw saved.error
      const ids=(saved.data??[]).map(item=>item.item_id)
      if(!ids.length) {delivered=true;outcomes.skipped++;continue}
      const current=await admin.from('available_items').select('id,name,availability,pending').in('id',ids)
      if(current.error) throw current.error
      const available=(current.data??[]).filter(item=>item.availability==='in_stock'||item.availability==='low')
      if(!available.length) {delivered=true;outcomes.skipped++;continue}
      const unsubscribeUrl=`${APP_URL}/api/unsubscribe?t=${encodeURIComponent(await unsubscribeToken(process.env.SUPABASE_SECRET_KEY!,digest.userId))}`
      const content=renderDigest(available.map(item=>({itemId:item.id,name:item.name,status:item.availability,kind:item.pending?'report':'confirm'})),
        {app:APP_URL,wishlist:`${APP_URL}/profile?list=wishlist`,unsubscribe:unsubscribeUrl})
      const result=await sendEmail({to:account.user.email,unsubscribeUrl,...content})
      if(result==='limited') {limited=true;outcomes.limited++}
      else {delivered=true;outcomes.sent++}
    } catch {outcomes.failed++}
    finally {
      const finished=await admin.rpc('finish_wishlist_notifications',{p_ids:digest.rowIds,p_claim_token:digest.claimToken,p_sent:delivered})
      if(finished.error) return res.status(503).json({error:'Could not record notification delivery; the lease will expire'})
    }
  }
  return res.status(200).json({digests:digests.length,...outcomes})
}
