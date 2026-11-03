import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { runRewardWorker } from './_lib/rewardWorker.js'

export const config = { maxDuration: 120 }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'GET or POST only' })
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' })
  try {
    const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } })
    return res.status(200).json(await runRewardWorker(admin))
  } catch {
    return res.status(503).json({ error: 'Reward worker unavailable. Check database migration, SMTP credentials, and APP_URL. Pending mail remains queued.' })
  }
}
