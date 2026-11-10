import { Outlet, createRootRoute } from '@tanstack/react-router'
import { Analytics } from '@vercel/analytics/react'
import { Navbar } from '../features/auth/Navbar'

export const Route = createRootRoute({
  component: () => (
    <>
      <Navbar />
      <div className="pantry-page">
        <Outlet />
      </div>
      <Analytics />
    </>
  ),
})
