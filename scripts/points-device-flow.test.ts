import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), from: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc: mock.rpc, auth: { getSession: mock.getSession }, from: mock.from } }))
import { loadPoints, recordDeviceJob, recordDeviceStock } from '../src/features/points/devicePoints'
import { readDevicePoints } from '../src/features/points/devicePointsStore'
const savedJob = { id:'1',item_id:'item1',created_at:new Date().toISOString(),status:'green',items:{name:'Barilla Spaghetti',brand:'Barilla'} }
let account = 0
beforeEach(() => {
  vi.clearAllMocks()
  account++
  mock.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}})
  mock.getSession.mockResolvedValue({data:{session:{user:{id:`user-${account}`,email:'student@mavs.uta.edu'}}},error:null})
  mock.from.mockImplementation((table: string) => {
    const query = {
      select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),in:vi.fn().mockReturnThis(),not:vi.fn().mockReturnThis(),gte:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),
      range:vi.fn().mockResolvedValue({data:[savedJob],error:null}),
      single:vi.fn().mockResolvedValue({data:savedJob,error:null}),
      then: (resolve: (value:unknown)=>unknown) => Promise.resolve({data:table==='items'?[{id:'item1',name:'Barilla Spaghetti',brand:'Barilla'}]:[savedJob],error:null}).then(resolve),
    }
    return query
  })
})
it('recovers real successful uploads into a visible device balance when the points RPC is absent', async () => {
  const result = await loadPoints(`user-${account}`)
  expect(result).toMatchObject({balance:1,earned:1,device_only:true,redemption_enabled:false})
  expect((await loadPoints(`user-${account}`)).balance).toBe(1)
})
it('records newly completed jobs immediately and makes retries idempotent', async () => {
  await recordDeviceJob('1'); await recordDeviceJob('1')
  expect((await readDevicePoints(`user-${account}`)).filter(entry=>entry.outcome==='earned')).toHaveLength(1)
  expect((await loadPoints(`user-${account}`)).balance).toBe(1)
})
it('ignores queued, failed, rejected and unidentified jobs', async () => {
  for (const status of ['queued','red','rejected','waiting_quota']) {
    mock.from.mockReturnValue({select:()=>({eq:()=>({eq:()=>({single:async()=>({data:{...savedJob,status},error:null})})})})})
    await recordDeviceJob('1')
  }
  expect(await readDevicePoints(`user-${account}`)).toEqual([])
})
it('records restock confirmations and suppresses repeat products and scan retries', async () => {
  expect((await recordDeviceStock(['item1'],'scan:1'))?.[0].outcome).toBe('earned')
  expect((await recordDeviceStock(['item1'],'scan:2'))?.[0].outcome).toBe('cooldown')
  await recordDeviceStock(['item1'],'scan:1')
  expect((await readDevicePoints(`user-${account}`)).filter(entry=>entry.outcome==='earned')).toHaveLength(1)
})
it('keeps server-backed balances authoritative without summing device points', async () => {
  await recordDeviceJob('1')
  mock.rpc.mockResolvedValue({data:{balance:20,earned:20,reward_threshold:100,recent_updates:[]},error:null})
  expect(await loadPoints(`user-${account}`)).toMatchObject({balance:20,device_only:false})
  await recordDeviceStock(['item1'],'scan:new')
  expect(await readDevicePoints(`user-${account}`)).toHaveLength(1)
})
it('never silently replaces an authentication or network error with device points', async () => {
  mock.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'Permission denied'}})
  await expect(loadPoints(`user-${account}`)).rejects.toMatchObject({code:'42501'})
  expect(mock.from).not.toHaveBeenCalled()
})
