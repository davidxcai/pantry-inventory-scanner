import { isPantryEmail } from './email'

export const VISIT_APPROVER_EMAIL = 'salmanfarse2025@gmail.com'
// UI routing only. Server approval still requires a verified,
// explicitly allowlisted auth user; entering this address grants no access.
export const isDesignatedVisitApproverEmail = (email: string | undefined) =>
  email?.trim().toLowerCase() === VISIT_APPROVER_EMAIL
export const canRegisterAccount = (email: string) => isPantryEmail(email)
export const REGISTRATION_EMAIL_MESSAGE = 'Use your @uta.edu, @mavs.uta.edu, or @gmail.com email address.'
