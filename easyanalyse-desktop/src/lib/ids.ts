export function makeId(prefix: string): string {
  const seed =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)

  return `${prefix}.${seed}`
}

export function makeLabel(prefix: string, index: number): string {
  return `${prefix.toUpperCase()} ${index.toString().padStart(2, '0')}`
}
