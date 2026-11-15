// Only app-local paths may be restored after an authentication round trip.
export function safeAuthRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\/(?![/\\])/.test(value)) return undefined
  if (/[\\\u0000-\u0020\u007f]/.test(value) || /%(?:00|0a|0d|5c)/i.test(value)) return undefined
  return value
}
