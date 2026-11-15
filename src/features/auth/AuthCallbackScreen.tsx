import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { completeGoogleSignIn } from './googleAuth'

export function AuthCallbackScreen() {
  const { redirect } = useSearch({ from: '/auth/callback' })
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void completeGoogleSignIn(redirect).then(async (destination) => {
      if (active) await navigate({ href: destination, replace: true })
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not finish Google sign-in. Please try again.')
    })
    return () => { active = false }
  }, [redirect, navigate])
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Google sign-in</h1>
      {error ? <>
        <p role="alert" className="alert alert-error alert-soft">{error}</p>
        <Link to="/login" search={{ redirect }} className="btn btn-primary">Back to sign in</Link>
      </> : <p role="status" className="flex items-center gap-2">
        <span className="loading loading-spinner loading-sm" aria-hidden="true" /> Finishing sign-in…
      </p>}
    </main>
  )
}
