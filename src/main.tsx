import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { supabase } from './lib/supabase'
import './index.css'

const queryClient = new QueryClient()
const router = createRouter({ routeTree })

// A reset link can land on any page: Supabase falls back to the Site URL when the requesting
// origin isn't an allowed redirect. Wherever it lands, send the user to choose a new password.
// Subscribed at startup because the client fires this event once, right after reading the link.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY' && router.state.location.pathname !== '/reset-password') {
    void router.navigate({ to: '/reset-password' })
  }
})

// A deploy replaces hashed chunks; tabs on the old build then request files that no longer exist.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
