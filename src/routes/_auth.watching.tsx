import { createFileRoute } from '@tanstack/react-router'
import { WatchingScreen } from '../features/catalog/WatchingScreen'

export const Route = createFileRoute('/_auth/watching')({ component: WatchingScreen })
