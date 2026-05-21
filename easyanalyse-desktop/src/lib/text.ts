export function safeText(value: unknown, fallback = ''): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || fallback
}

export function compareText(left: unknown, right: unknown): number {
  return safeText(left).localeCompare(safeText(right))
}

export function coerceText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

export function compareCoercedText(left: unknown, right: unknown): number {
  return coerceText(left).localeCompare(coerceText(right))
}
