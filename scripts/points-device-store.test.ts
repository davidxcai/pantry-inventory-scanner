import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { readDevicePoints, saveDeviceReports } from '../src/features/points/devicePointsStore'
const report = { sourceId:'job:1',jobId:'1',itemId:'item1',name:'Barilla Spaghetti',brand:'Barilla',occurredAt:'2026-11-02T18:00:00Z' }
it('persists account points across reads and isolates other signed-in accounts', async () => {
  await saveDeviceReports('alice',[report])
  expect((await readDevicePoints('alice'))[0].outcome).toBe('earned')
  expect(await readDevicePoints('bob')).toEqual([])
})
it('uses atomic IndexedDB updates to prevent duplicate awards from concurrent tabs', async () => {
  await Promise.all([
    saveDeviceReports('concurrent',[report]),
    saveDeviceReports('concurrent',[{ ...report,sourceId:'job:2',jobId:'2',itemId:'copy' }]),
    saveDeviceReports('concurrent',[report]),
  ])
  const rows = await readDevicePoints('concurrent')
  expect(rows).toHaveLength(2)
  expect(rows.filter(row => row.outcome==='earned')).toHaveLength(1)
})
it('keeps different products and future-week restocks, but never double awards a scan item', async () => {
  await saveDeviceReports('restock',[report,{ ...report,sourceId:'scan:1:item2',itemId:'item2',name:'Ritz Crackers' }])
  await saveDeviceReports('restock',[{ ...report,sourceId:'scan:1:item2',itemId:'item2',name:'Ritz Crackers' }])
  await saveDeviceReports('restock',[{ ...report,sourceId:'job:later',occurredAt:'2026-11-09T18:00:00Z' }])
  expect((await readDevicePoints('restock')).filter(row => row.outcome==='earned')).toHaveLength(3)
})
