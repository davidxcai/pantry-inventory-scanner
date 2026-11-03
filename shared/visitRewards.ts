import { z } from 'zod'
import { VISIT_APPROVER_EMAIL } from './visitApprover'

export const VisitRequestSchema = z.object({
  id: z.uuid(), user_id: z.uuid(), cost: z.literal(100),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'expired', 'used']),
  created_at: z.string(), decided_at: z.string().nullable(), decided_by: z.string().nullable(),
  decision_note: z.string().nullable(), expires_at: z.string().nullable(), used_at: z.string().nullable(),
  student_email: z.string().optional(), student_name: z.string().optional(),
})
export type VisitRequest = z.infer<typeof VisitRequestSchema>
export const APPOINTMENT_INSTRUCTIONS = 'Your extra visit is approved. Reply to the approval email to arrange your appointment before visiting.'
export const rewardDate = (value: string) => new Date(value).toLocaleString('en-US', {
  timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
})
export const rewardStatus = (request: VisitRequest, now = Date.now()) =>
  request.status === 'approved' && request.expires_at && new Date(request.expires_at).getTime() <= now ? 'expired' : request.status

// Opens a user-sent email draft only. It never creates an approval or spends points.
export function manualVisitRequestMailto(student: { userId: string; name: string; email: string; points: number; deviceOnly: boolean }) {
  const subject = 'Extra pantry visit request — approval required'
  const body = [
    'Hello,', '', 'I would like to request an extra pantry visit for your approval.', '',
    `Name: ${student.name}`, `Student email: ${student.email}`, `Account: ${student.userId}`,
    `Available points: ${student.points}`,
    `Points source: ${student.deviceOnly ? 'device-only development balance; please verify eligibility manually' : 'shared account balance'}.`, '',
    'Please review my eligibility and confirm whether this request is approved, along with the appointment details.',
    'I understand that this email does not book an appointment or grant permission to visit.', '', 'Thank you.',
  ].join('\n')
  return `mailto:${VISIT_APPROVER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
