import { createFileRoute } from '@tanstack/react-router'
import { PointsScreen } from '../features/points/PointsScreen'

export const Route = createFileRoute('/_auth/points')({ component: PointsScreen })
