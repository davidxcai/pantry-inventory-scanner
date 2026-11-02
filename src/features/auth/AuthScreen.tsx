import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { supabase } from '../../lib/supabase'
import { UTA_EMAIL_MESSAGE, isUtaEmail } from '../../../shared/email'

type Mode = 'signin' | 'register' | 'forgot'

export function AuthScreen() {
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: '/login' })
  const [mode, setMode] = useState<Mode>('signin')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Signed in with an address whose confirmation link was never clicked.
  const [unconfirmed, setUnconfirmed] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
    setUnconfirmed(false)
  }

  async function resendConfirmation() {
    setBusy(true)
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
    setBusy(false)
    setError(error ? error.message : null)
    if (!error) {
      setUnconfirmed(false)
      setNotice('A new confirmation link is on its way. Check your junk folder too.')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setUnconfirmed(false)

    if (mode === 'register' && !isUtaEmail(email)) {
      setError(UTA_EMAIL_MESSAGE)
      return
    }

    const first = firstName.trim()
    const last = lastName.trim()
    setBusy(true)
    const trimmed = email.trim()
    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) setError(error.message)
      else setNotice('If an account exists for that email, a reset link is on its way. Check your junk folder too.')
    } else if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password })
      if (error?.code === 'email_not_confirmed') {
        setUnconfirmed(true)
        setError('Confirm your email first. Open the link we sent you when you registered.')
      } else if (error) setError(error.message)
      else await navigate({ href: redirect ?? '/' })
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: trimmed,
        password,
        options: {
          // The confirmation link signs them in and lands on the catalog.
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            first_name: first,
            last_name: last,
            display_name: `${first} ${last}`,
          },
        },
      })
      if (error) setError(error.message)
      // With email confirmation on, Supabase doesn't error for an existing
      // email. It returns a placeholder user with no identities instead.
      else if (data.user && data.user.identities?.length === 0)
        setError('An account with this email already exists. Sign in, or use "Forgot password" if you need to reset it.')
      else if (data.session) await navigate({ href: redirect ?? '/' })
      else setNotice('Check your email (and junk folder) for a confirmation link, then sign in.')
    }
    setBusy(false)
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 p-4">
      <div role="tablist" className="tabs tabs-box">
        <button role="tab" className={`tab flex-1 ${mode !== 'register' ? 'tab-active' : ''}`} onClick={() => switchMode('signin')}>
          Sign in
        </button>
        <button role="tab" className={`tab flex-1 ${mode === 'register' ? 'tab-active' : ''}`} onClick={() => switchMode('register')}>
          Register
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === 'register' && (
          <>
            <p className="text-sm text-base-content/70">
              Your name is shown publicly next to the items you update.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm">First name</span>
                <input
                  required
                  maxLength={20}
                  autoComplete="given-name"
                  className="input w-full"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm">Last name</span>
                <input
                  required
                  maxLength={19}
                  autoComplete="family-name"
                  className="input w-full"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </label>
            </div>
          </>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-sm">UTA email</span>
          <input
            type="email"
            required
            autoComplete="email"
            className="input w-full"
            placeholder="you@mavs.uta.edu"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {mode !== 'forgot' && (
        <label className="flex flex-col gap-1">
          <span className="text-sm">Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        )}
        {mode === 'signin' && (
          <button type="button" className="link link-hover self-end text-sm" onClick={() => switchMode('forgot')}>
            Forgot password?
          </button>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy && <span className="loading loading-spinner loading-xs" />}
          {mode === 'signin' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
        </button>
        {mode === 'forgot' && (
          <button type="button" className="link link-hover text-sm" onClick={() => switchMode('signin')}>
            Back to sign in
          </button>
        )}
      </form>

      {error && <div role="alert" className="alert alert-error alert-soft">{error}</div>}
      {unconfirmed && (
        <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={resendConfirmation}>
          Resend confirmation email
        </button>
      )}
      {notice && <div role="status" className="alert alert-info alert-soft">{notice}</div>}
    </main>
  )
}
