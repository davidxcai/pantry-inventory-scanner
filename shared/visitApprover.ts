import { isUtaEmail } from './email'

export const VISIT_APPROVER_EMAIL = 'salmanfarse2025@gmail.com'
// Registration/UI routing only. Server approval still requires a verified,
// explicitly allowlisted auth user; entering this address grants no access.
export const isDesignatedVisitApproverEmail = (email: string | undefined) =>
  email?.trim().toLowerCase() === VISIT_APPROVER_EMAIL
export const canRegisterAccount = (email: string) => isUtaEmail(email) || isDesignatedVisitApproverEmail(email)
export const REGISTRATION_EMAIL_MESSAGE = 'Use your @uta.edu or @mavs.uta.edu email, or the designated visit approver account.'
