import { recordDeviceJob } from '../features/points/devicePoints'
import { queryClient } from './queryClient'
import { refreshPoints } from '../features/points/refreshPoints'
import { supabase } from './supabase'

// Both photo flows use the same authenticated backend. No model/service keys reach the browser.
export async function requestPhotoAnalysis(kind: 'identify' | 'shelf', id: string): Promise<void> {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error('Sign in again to identify your saved photo.')
  let response: Response
  try {
    response = await fetch(`/api/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(kind === 'identify' ? { jobId: id } : { scanId: id }),
    })
  } catch {
    throw new Error('Could not connect to photo identification. Your photo is saved. Retry when you are online, or enter the product details manually.')
  }
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error('Photo identification is unavailable on this server. Your photo is saved. Retry, or enter the product details manually.')
  }
  const body = await response.json().catch(() => null) as { status?: string; error?: string } | null
  if (response.status === 409) { if (kind === 'identify') await recordDeviceJob(id); await refreshPoints(queryClient); return } // Already claimed/handled; the job status is the source of truth.
  if (response.status === 401) throw new Error('Your sign-in expired. Sign in again, then retry this photo.')
  if (!response.ok) throw new Error(body?.error ? `Could not identify this photo: ${body.error}` : `Photo identification failed (${response.status}). Retry or enter the product details manually.`)
  if (!body?.status) throw new Error('Photo identification returned an invalid response. Your photo is saved; please retry.')
  if (kind === 'identify') await recordDeviceJob(id)
  await Promise.all([
    refreshPoints(queryClient),
    queryClient.invalidateQueries({ queryKey: ['intake-jobs'] }),
    queryClient.invalidateQueries({ queryKey: ['review-job'] }),
    queryClient.invalidateQueries({ queryKey: ['public-catalog'] }),
    queryClient.invalidateQueries({ queryKey: ['shelf-scan'] }),
    queryClient.invalidateQueries({ queryKey: ['shelf-scans'] }),
  ])
}
