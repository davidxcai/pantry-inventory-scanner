// Read-only deployment check. It never claims jobs, changes stock, or sends email.
import { loadEnv } from 'vite'
import { createClient } from '@supabase/supabase-js'

const env = loadEnv('development', process.cwd(), '')
for (const [key, value] of Object.entries(env)) process.env[key] ??= value

const required = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'APP_URL', 'CRON_SECRET']
const missing = required.filter((key) => !process.env[key])
if (missing.length) {
  console.error(`Missing server configuration: ${missing.join(', ')}`)
  console.error('Configure these in the server environment. Never put mail or service credentials in VITE_ variables.')
  process.exitCode = 1
} else {
  try {
    const { wishlistMailConfig } = await import('../api/_lib/sendEmail.js')
    const config = wishlistMailConfig()
    console.log(`Email provider configured: ${config.provider}`)
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
    })
    const tables = [
      ['watchlist_items', 'user_id,item_id'],
      ['wishlist_items', 'user_id,item_id'],
      ['wishlist_email_preferences', 'user_id,enabled'],
      ['notification_queue', 'id,type,claim_token,claimed_until'],
    ] as const
    for (const [table, columns] of tables) {
      const { error } = await db.from(table).select(columns).limit(0)
      if (error) {
        console.error(`Missing or inaccessible notification schema: ${table} (${error.code || 'connection error'})`)
        process.exitCode = 1
      } else console.log(`Schema ready: ${table}`)
    }
    if (!process.exitCode) {
      console.log('Server configuration and table checks passed. No email was sent.')
      console.log('Also verify the send-stock-notifications Supabase cron job and its Vault URL/secret; see docs/wishlist.md.')
    }
  } catch {
    console.error('Email setup check failed. Verify APP_URL, the selected provider credentials, and the database connection.')
    process.exitCode = 1
  }
}
