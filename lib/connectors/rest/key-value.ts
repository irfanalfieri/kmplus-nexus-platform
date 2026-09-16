export interface KeyValuePair {
  key: string
  value: string
  enabled: boolean
  description?: string
}

export const EMPTY_KV: KeyValuePair[] = [{ key: '', value: '', enabled: true }]

export function parseKeyValueList(raw: string, fallbackObject?: Record<string, string>): KeyValuePair[] {
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          key: String((item as KeyValuePair).key ?? ''),
          value: String((item as KeyValuePair).value ?? ''),
          enabled: (item as KeyValuePair).enabled !== false,
          description: (item as KeyValuePair).description,
        }))
      }
    } catch {
      /* fall through */
    }
  }

  if (fallbackObject && Object.keys(fallbackObject).length) {
    return Object.entries(fallbackObject).map(([key, value]) => ({
      key,
      value,
      enabled: true,
    }))
  }

  return [{ key: '', value: '', enabled: true }]
}

export function serializeKeyValueList(pairs: KeyValuePair[]): string {
  const cleaned = pairs.filter((p) => p.key.trim() || p.value.trim())
  return JSON.stringify(cleaned.length ? cleaned : [{ key: '', value: '', enabled: true }])
}

export function activePairs(pairs: KeyValuePair[]): KeyValuePair[] {
  return pairs.filter((p) => p.enabled && p.key.trim())
}

export function pairsToRecord(pairs: KeyValuePair[]): Record<string, string> {
  return Object.fromEntries(activePairs(pairs).map((p) => [p.key.trim(), p.value]))
}

export function pairsToUrlEncoded(pairs: KeyValuePair[]): string {
  const params = new URLSearchParams()
  for (const pair of activePairs(pairs)) {
    params.set(pair.key.trim(), pair.value)
  }
  return params.toString()
}
