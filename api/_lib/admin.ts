import { createClient } from '@supabase/supabase-js'

// Email workers need the database, without initializing the photo-analysis client.
export const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
})
