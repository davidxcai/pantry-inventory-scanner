import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

// undefined while the stored session is still loading, null when signed out.
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  return session
}

export const displayNameOf = (session: Session) => {
  const { first_name, last_name, display_name } = session.user.user_metadata as Record<string, string | undefined>
  const full = [first_name, last_name].filter(Boolean).join(' ')
  return full || display_name || session.user.email || 'Account'
}
