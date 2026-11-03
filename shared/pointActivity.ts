import { z } from 'zod'
export const PointActivitySchema = z.object({
  id: z.string(), item_id: z.string(), job_id: z.string().nullable(), item_name: z.string(),
  outcome: z.enum(['earned', 'cooldown']), created_at: z.iso.datetime({ offset: true }), next_eligible_at: z.iso.datetime({ offset: true }),
})
export type PointActivity = z.infer<typeof PointActivitySchema>
