import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), close: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: mock.createTransport } }))
import { sendEmail, wishlistMailConfig } from '../api/_lib/sendEmail'

const email = {
  to: 'student@mavs.uta.edu', subject: 'Rice is available', text: 'Rice: In stock',
  html: '<p>Rice: In stock</p>', unsubscribeUrl: 'https://pantry.test/api/unsubscribe?t=signed',
}
const fetcher = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('APP_URL', 'https://pantry.test')
  for (const name of ['RESEND_API_KEY', 'RESEND_EMAIL_DOMAIN', 'SMTP_USER', 'SMTP_PASS']) vi.stubEnv(name, '')
  vi.stubGlobal('fetch', fetcher)
  mock.createTransport.mockReturnValue({ sendMail: mock.sendMail, close: mock.close })
  mock.sendMail.mockResolvedValue({ accepted: [email.to] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('sends through the existing Gmail configuration with unsubscribe headers', async () => {
  vi.stubEnv('SMTP_USER', 'sender@gmail.com'); vi.stubEnv('SMTP_PASS', 'test-app-password')
  expect(wishlistMailConfig().provider).toBe('smtp')
  expect(await sendEmail(email)).toBe('sent')
  expect(mock.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.gmail.com', secure: true }))
  expect(mock.sendMail).toHaveBeenCalledWith(expect.objectContaining({
    to: email.to, text: email.text, html: email.html,
    headers: { 'List-Unsubscribe': `<${email.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }))
  expect(mock.close).toHaveBeenCalledOnce()
  expect(fetcher).not.toHaveBeenCalled()
})
it('uses Resend when configured and keeps rate-limited mail retryable', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-key'); vi.stubEnv('RESEND_EMAIL_DOMAIN', 'pantry.test')
  vi.stubEnv('SMTP_USER', 'sender@gmail.com'); vi.stubEnv('SMTP_PASS', 'test-app-password')
  fetcher.mockResolvedValueOnce({ status: 429 }).mockResolvedValueOnce({ status: 200, ok: true })
  expect(await sendEmail(email)).toBe('limited')
  expect(await sendEmail(email)).toBe('sent')
  const message = JSON.parse(fetcher.mock.calls[1][1].body)
  expect(message).toMatchObject({ from: 'Thyme Saver <alerts@pantry.test>', to: email.to })
  expect(message.headers['List-Unsubscribe']).toBe(`<${email.unsubscribeUrl}>`)
  expect(mock.sendMail).not.toHaveBeenCalled()
})
it('propagates SMTP failures for worker retry and closes the connection', async () => {
  vi.stubEnv('SMTP_USER', 'sender@gmail.com'); vi.stubEnv('SMTP_PASS', 'test-app-password')
  mock.sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'))
  await expect(sendEmail(email)).rejects.toThrow('SMTP unavailable')
  expect(mock.close).toHaveBeenCalledOnce()
})
it('fails before making requests when sender configuration is incomplete', async () => {
  await expect(sendEmail(email)).rejects.toThrow('Configure')
  vi.stubEnv('RESEND_API_KEY', 'test-key')
  expect(() => wishlistMailConfig()).toThrow('RESEND_EMAIL_DOMAIN')
  vi.stubEnv('APP_URL', 'http://pantry.test')
  expect(() => wishlistMailConfig()).toThrow('HTTPS')
  expect(fetcher).not.toHaveBeenCalled()
  expect(mock.sendMail).not.toHaveBeenCalled()
})
it('does not silently switch provider after a delivery failure', async () => {
  vi.stubEnv('RESEND_API_KEY', 'test-key'); vi.stubEnv('RESEND_EMAIL_DOMAIN', 'pantry.test')
  vi.stubEnv('SMTP_USER', 'sender@gmail.com'); vi.stubEnv('SMTP_PASS', 'test-app-password')
  fetcher.mockResolvedValueOnce({ status: 403, ok: false })
  await expect(sendEmail(email)).rejects.toThrow('403')
  expect(mock.sendMail).not.toHaveBeenCalled()
})
