import { afterEach, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Importing the photo-analysis library would break notification-only deployments.
vi.mock('@google/genai', () => { throw new Error('Email worker must not initialize Gemini') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('starts the notification and unsubscribe endpoints without photo-analysis credentials', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'server-test-key')
  vi.stubEnv('GEMINI_API_KEY', '')
  vi.stubEnv('CRON_SECRET', 'test-cron')
  const network = vi.fn()
  vi.stubGlobal('fetch', network)
  const { default: notify } = await import('../api/notify')
  const { default: unsubscribe } = await import('../api/unsubscribe')
  expect(unsubscribe).toBeTypeOf('function')
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  await notify({ method: 'POST', headers: {} } as VercelRequest, response as unknown as VercelResponse)
  expect(response.status).toHaveBeenCalledWith(401)
  expect(network).not.toHaveBeenCalled()
})
