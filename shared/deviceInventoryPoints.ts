import { z } from 'zod'

export const POINT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
export function inventoryProductKey(name: string, brand: string | null = null) {
  const words = `${brand ?? ''} ${name}`.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '')
    .replace(/\b[0-9]+([.,][0-9]+)?\s*(fl\.?\s*oz|oz|ounces?|lbs?|pounds?|kg|g|ml|l|ct|count|pk|packs?|capsules?|softgels?|tablets?|gummies|rolls?|packets?|bags?|bottles?|cans?)\b\.?/g, ' ')
    .replace(/[^a-z0-9%.\s]/g, ' ').replace(/(?<![0-9])\.|\.(?![0-9])/g, ' ').split(/\s+/)
    .filter(word => word && !['the','a','an','of','and','with','for','in'].includes(word))
    .map(word => word.length > 4 && word.endsWith('ies') ? `${word.slice(0,-3)}y` : word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word) ? word.slice(0,-1) : word)
  return [...new Set(words)].sort().join(' ')
}
export const DevicePointEntrySchema = z.object({
  id: z.string(), item_id: z.string(), job_id: z.string().nullable(), product_key: z.string(), item_name: z.string(),
  outcome: z.enum(['earned','cooldown']), created_at: z.iso.datetime({ offset: true }), next_eligible_at: z.iso.datetime({ offset: true }),
})
export type DevicePointEntry = z.infer<typeof DevicePointEntrySchema>
export type PointReport = { sourceId: string; itemId: string; name: string; brand: string | null; occurredAt: string; jobId?: string }
export function recordPointReports(entries: DevicePointEntry[], reports: PointReport[]) {
  const next = [...entries]
  for (const report of [...reports].sort((a,b) => a.occurredAt.localeCompare(b.occurredAt) || a.sourceId.localeCompare(b.sourceId))) {
    if (next.some(entry => entry.id === report.sourceId)) continue
    const key = inventoryProductKey(report.name, report.brand)
    const at = new Date(report.occurredAt).getTime()
    if (!key || !Number.isFinite(at)) continue
    const previous = next.filter(entry => entry.outcome === 'earned' && (entry.item_id === report.itemId || entry.product_key === key)
      && Math.abs(new Date(entry.created_at).getTime() - at) < POINT_COOLDOWN_MS)
      .reduce((latest,entry) => Math.max(latest,new Date(entry.created_at).getTime()), -Infinity)
    next.push({ id: report.sourceId, item_id: report.itemId, job_id: report.jobId ?? null, product_key: key, item_name: report.name,
      outcome: Number.isFinite(previous) ? 'cooldown' : 'earned', created_at: new Date(at).toISOString(),
      next_eligible_at: new Date((Number.isFinite(previous) ? previous : at) + POINT_COOLDOWN_MS).toISOString() })
  }
  return next
}
