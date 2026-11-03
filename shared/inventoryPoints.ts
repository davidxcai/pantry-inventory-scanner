import { z } from 'zod'
import { VisitRequestSchema } from './visitRewards'

export const POINTS_MILESTONE = 100
export const PointsSummarySchema = z.object({
  device_only: z.boolean().default(false),
  sync_warning: z.string().nullable().default(null),
  balance: z.number().int().nonnegative(),
  earned: z.number().int().nonnegative(),
  reward_threshold: z.number().int().positive(),
  reserved: z.number().int().nonnegative().default(0),
  spent: z.number().int().nonnegative().default(0),
  redemption_enabled: z.boolean().default(false),
  is_approver: z.boolean().default(false),
  current_reward: VisitRequestSchema.nullable().default(null),
  requests: z.array(VisitRequestSchema).default([]),
  recent_updates: z.array(z.object({ id: z.string(), item_name: z.string(), created_at: z.iso.datetime({ offset: true }) })),
})
export type PointsSummary = z.infer<typeof PointsSummarySchema>

// Milestones track the available balance; earning records are never reset.
export function pointsProgress(balance: number, threshold = POINTS_MILESTONE) {
  const milestones = Math.floor(balance / threshold)
  const progress = balance % threshold
  return { milestones, progress, nextMilestone: (milestones + 1) * threshold, remaining: threshold - progress }
}
