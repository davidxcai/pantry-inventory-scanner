import { requestPhotoAnalysis } from '../../lib/photoApi'
import { supabase } from '../../lib/supabase'
import type { PendingCapture } from './queueDb'

// Upload one capture and create its job. Safe to repeat: storage uses upsert and a duplicate
// job id counts as already done, so a retry after a dropped connection never double-counts.
export async function uploadCapture(c: PendingCapture): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  if (!session) throw new Error('Sign in again to upload your saved photo.')

  // Photos live under the user's id; storage rules only let a user reach their own folder.
  const photoPath = `${session.user.id}/${c.batchId}/${c.id}.jpg`
  const opts = { contentType: 'image/jpeg', upsert: true }
  const [photo, thumb] = await Promise.all([
    supabase.storage.from('intake-photos').upload(photoPath, c.photo, opts),
    supabase.storage.from('thumbnails').upload(`${c.id}.jpg`, c.thumb, opts),
  ])
  if (photo.error) throw new Error(`Could not upload the photo: ${photo.error.message}`)
  if (thumb.error) throw new Error(`Could not upload the preview: ${thumb.error.message}`)

  const { error } = await supabase.from('intake_jobs').insert({
    id: c.id,
    batch_id: c.batchId,
    photo_path: photoPath,
    availability: c.availability ?? 'in_stock',
    created_by: session.user.id,
  })
  if (error && error.code !== '23505') throw new Error(`Could not save the upload: ${error.message}`)
}

// Cancel a job that never produced an item. The server refuses jobs that are already done, and an
// identify run still in flight drops its result instead of reviving the job.
export async function cancelJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_intake_job', { p_job_id: jobId })
  if (error) throw error
}

// The queue records failures so they stay visible and retryable after leaving Add item.
export const requestIdentify = (jobId: string) => requestPhotoAnalysis('identify', jobId)
