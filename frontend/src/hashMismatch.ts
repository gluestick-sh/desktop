/** Parse engine integrity errors like:
 * integrity check failed: hash mismatch (expected sha256:abc…, got def…)
 */
export function parseHashMismatch(error: string): {
  algo: string
  expected: string
  got: string
} | null {
  const text = String(error || '')
  const match = text.match(
    /hash mismatch\s*\(\s*expected\s+([a-z0-9]+):([a-f0-9]+)\s*,\s*got\s+([a-f0-9]+)\s*\)/i,
  )
  if (!match) return null
  return {
    algo: match[1].toLowerCase(),
    expected: match[2].toLowerCase(),
    got: match[3].toLowerCase(),
  }
}

export function formatOverrideHash(algo: string, hex: string): string {
  const a = algo.trim().toLowerCase() || 'sha256'
  const h = hex.trim().toLowerCase()
  if (!h) return ''
  if (h.includes(':')) return h
  return `${a}:${h}`
}

/** Strip optional algo prefix and lowercase for digest comparison. */
export function normalizeHashDigest(hash: string): string {
  const s = String(hash || '').trim().toLowerCase()
  if (!s) return ''
  const i = s.lastIndexOf(':')
  return i >= 0 ? s.slice(i + 1) : s
}
