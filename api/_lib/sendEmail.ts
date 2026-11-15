import nodemailer from 'nodemailer'

export const APP_URL = process.env.APP_URL ?? 'https://utapantry.xyz'
export type Email = { to: string; subject: string; text: string; html: string; unsubscribeUrl: string }

type MailConfig =
  | { provider: 'resend'; apiKey: string; from: string }
  | { provider: 'smtp'; user: string; pass: string; from: string }

// Validate before leasing jobs so a missing provider never consumes a delivery attempt.
export function wishlistMailConfig(): MailConfig {
  const app = new URL(process.env.APP_URL || '')
  if (app.protocol !== 'https:' && !(app.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(app.hostname))) {
    throw new Error('APP_URL must use HTTPS (HTTP allowed for localhost)')
  }
  if (process.env.RESEND_API_KEY) {
    if (!process.env.RESEND_EMAIL_DOMAIN) throw new Error('Configure RESEND_EMAIL_DOMAIN')
    return {
      provider: 'resend', apiKey: process.env.RESEND_API_KEY,
      from: `Thyme Saver <alerts@${process.env.RESEND_EMAIL_DOMAIN}>`,
    }
  }
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      provider: 'smtp', user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
      from: `Thyme Saver <${process.env.SMTP_USER}>`,
    }
  }
  throw new Error('Configure Resend or SMTP credentials for wishlist emails')
}

// Provider rate limits leave messages queued for the next scheduled attempt.
export async function sendEmail(email: Email): Promise<'sent' | 'limited'> {
  const config = wishlistMailConfig()
  const headers = {
    'List-Unsubscribe': `<${email.unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
  if (config.provider === 'smtp') {
    // Reuse the Gmail app-password configuration used by extra-visit emails.
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000,
    })
    try {
      await transport.sendMail({
        from: config.from, to: email.to, subject: email.subject,
        text: email.text, html: email.html, headers,
      })
      return 'sent'
    } finally {
      transport.close()
    }
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.from, to: email.to, subject: email.subject,
      text: email.text, html: email.html, headers,
    }),
  })
  if (response.status === 429) return 'limited'
  if (!response.ok) throw new Error(`Email provider rejected delivery (${response.status})`)
  return 'sent'
}
