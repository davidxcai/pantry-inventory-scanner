import nodemailer from 'nodemailer'
import { VISIT_APPROVER_EMAIL } from '../../shared/visitApprover.js'
import { APPOINTMENT_INSTRUCTIONS, rewardDate, type VisitRequest } from '../../shared/visitRewards.js'

export const reviewRecipient = () => process.env.VISIT_REVIEW_EMAIL || VISIT_APPROVER_EMAIL
export function rewardMailConfig() {
  const { SMTP_USER, SMTP_PASS, APP_URL } = process.env
  if (!SMTP_USER || !SMTP_PASS || !APP_URL) throw new Error('Configure SMTP_USER, SMTP_PASS and APP_URL before sending reward emails')
  const url = new URL(APP_URL)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('APP_URL must use HTTPS (HTTP allowed for localhost)')
  return { user: SMTP_USER, pass: SMTP_PASS, origin: url.origin }
}
export function buildRewardEmail(kind: 'pending' | 'approved' | 'rejected', request: VisitRequest, student: { email: string; name: string }, origin: string) {
  const details = `Student: ${student.name}\nEmail: ${student.email}\nRequest: ${request.id}\nSubmitted: ${rewardDate(request.created_at)} (America/Chicago)`
  if (kind === 'pending') return {
    to: reviewRecipient(), replyTo: student.email, subject: 'Extra pantry visit requested — 100 points reserved',
    text: `${details}\n\n100 points have been reserved for this request.\nReview: ${origin}/visit-review?request=${encodeURIComponent(request.id)}\n\nSign in with your designated approver account and explicitly approve or reject. Opening this link does not approve the request.`,
  }
  return {
    to: student.email, replyTo: reviewRecipient(), subject: kind === 'approved' ? 'Your extra pantry visit is approved' : 'Your extra pantry visit request was declined',
    text: `${details}\n\n${kind === 'approved' ? `${process.env.VISIT_APPOINTMENT_INSTRUCTIONS || APPOINTMENT_INSTRUCTIONS}\n100 points were spent. Valid until ${rewardDate(request.expires_at!)} (America/Chicago). An unused reward expires and refunds automatically. This approval does not book an appointment or guarantee pantry admission.` : 'Your request was declined. The reserved 100 points are available again.'}${request.decision_note ? `\n\nReviewer note: ${request.decision_note}` : ''}\n\nView your current status: ${origin}/points`,
  }
}
export function createRewardSender() {
  const config = rewardMailConfig()
  const transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: config.user, pass: config.pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 })
  return {
    origin: config.origin,
    async send(id: string, message: ReturnType<typeof buildRewardEmail>) {
      await transport.sendMail({ ...message, from: config.user, messageId: `<visit-reward-${id}@${config.user.split('@')[1]}>` })
    },
  }
}
