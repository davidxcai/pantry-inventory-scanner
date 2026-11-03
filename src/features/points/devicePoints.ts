import { isUtaEmail } from '../../../shared/email'
import { POINT_COOLDOWN_MS, type PointReport } from '../../../shared/deviceInventoryPoints'
import { PointsSummarySchema } from '../../../shared/inventoryPoints'
import { supabase } from '../../lib/supabase'
import { readDevicePoints, saveDeviceReports } from './devicePointsStore'

export function missingPointsBackend(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && ['PGRST202','PGRST205','42883','42P01'].includes(String(error.code))
}
type SavedJob = { id: string; item_id: string | null; created_at: string; status: string; items: { name: string; brand: string | null } | null }
function jobReports(jobs: SavedJob[], now?: string): PointReport[] {
  return jobs.filter(job => !!job.item_id && !!job.items && ['green','yellow'].includes(job.status)).map(job => ({
    sourceId: `job:${job.id}`, jobId: job.id, itemId: job.item_id!, name: job.items!.name, brand: job.items!.brand,
    occurredAt: now ?? job.created_at,
  }))
}
export async function reconcileDeviceJobs(userId: string) {
  const jobs: SavedJob[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('intake_jobs').select('id,item_id,created_at,status,items(name,brand)')
      .eq('created_by',userId).in('status',['green','yellow']).not('item_id','is',null)
      .gte('created_at',new Date(Date.now()-POINT_COOLDOWN_MS).toISOString()).order('created_at').order('id').range(offset,offset+499)
    if (error) throw error
    jobs.push(...data as unknown as SavedJob[])
    if (data.length < 500) break
  }
  return saveDeviceReports(userId, jobReports(jobs))
}
export async function loadPoints(userId: string) {
  const { data, error } = await supabase.rpc('get_inventory_points')
  if (!error) return PointsSummarySchema.parse(data)
  if (!missingPointsBackend(error)) throw error
  const session = await supabase.auth.getSession()
  if (session.error || session.data.session?.user.id !== userId || !isUtaEmail(session.data.session.user.email ?? '')) throw new Error('Sign in with your UTA account to earn points.')
  let warning: string | null = null
  try { await reconcileDeviceJobs(userId) } catch { warning = 'Could not check recent uploads. Your saved device balance is shown; refresh to retry.' }
  const entries = await readDevicePoints(userId)
  const awards = entries.filter(entry => entry.outcome === 'earned')
  return PointsSummarySchema.parse({ balance: awards.length, earned: awards.length, reward_threshold: 100,
    device_only: true, sync_warning: warning, recent_updates: awards.sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,20) })
}
// These helpers run only after a successful inventory save. Failure to save device
// feedback must never turn a successful stock operation into a failed upload.
export async function recordDeviceJob(jobId: string) {
  try {
    const { data: session } = await supabase.auth.getSession()
    if (!session.session || !isUtaEmail(session.session.user.email ?? '')) return
    const { error } = await supabase.rpc('get_inventory_points')
    if (!missingPointsBackend(error)) return
    const result = await supabase.from('intake_jobs').select('id,item_id,created_at,status,items(name,brand)')
      .eq('created_by',session.session.user.id).eq('id',jobId).single()
    if (result.error) return
    await saveDeviceReports(session.session.user.id,jobReports([result.data as unknown as SavedJob],new Date().toISOString()))
  } catch { /* loadPoints retries recovery from saved server jobs. */ }
}
export async function recordDeviceStock(itemIds: string[], source: string) {
  try {
    const { data: session } = await supabase.auth.getSession()
    if (!session.session || !isUtaEmail(session.session.user.email ?? '')) return null
    const { error } = await supabase.rpc('get_inventory_points')
    if (!missingPointsBackend(error)) return null
    const { data, error: itemError } = await supabase.from('items').select('id,name,brand').in('id',[...new Set(itemIds)])
    if (itemError) throw itemError
    const reports = data.map(item => ({ sourceId: `${source}:${item.id}`, itemId: item.id, name: item.name, brand: item.brand,
      occurredAt: new Date().toISOString() }))
    const entries = await saveDeviceReports(session.session.user.id,reports)
    return entries.filter(entry => reports.some(report => report.sourceId === entry.id))
  } catch { return null }
}
