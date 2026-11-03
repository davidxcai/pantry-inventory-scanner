import { createFileRoute } from '@tanstack/react-router'
import { ProfileScreen } from '../features/profile/ProfileScreen'

export const Route = createFileRoute('/_auth/profile')({ component: ProfileScreen })
