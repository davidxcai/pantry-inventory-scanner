import { createStore, get, update } from 'idb-keyval'
import { z } from 'zod'
import { DevicePointEntrySchema, recordPointReports, type PointReport, type DevicePointEntry } from '../../../shared/deviceInventoryPoints'

let store: ReturnType<typeof createStore> | undefined
const db = () => store ??= createStore('pantry-device-points', 'accounts')
const key = (userId: string) => `${import.meta.env.VITE_SUPABASE_URL ?? 'local'}:${userId}`
const parse = (data: unknown) => z.array(DevicePointEntrySchema).parse(data ?? [])
export async function readDevicePoints(userId: string): Promise<DevicePointEntry[]> { return parse(await get(key(userId),db())) }
export async function saveDeviceReports(userId: string, reports: PointReport[]) {
  // IndexedDB read/write transaction: multiple tabs cannot award the same product twice.
  await update(key(userId), old => recordPointReports(parse(old),reports),db())
  return readDevicePoints(userId)
}
