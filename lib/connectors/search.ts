import { CONNECTOR_GROUPS, type ConnectorGroup } from './types'

/**
 * Search and grouping for the Connectors screen. Pure and client-safe.
 * A query matches when every word in it starts a word of the connector's name,
 * slug, category, description, group or keywords (plus any translated text the
 * screen passes in), so "hris", "excel", "active dir" or "sql server" find the
 * right connector without matching inside unrelated words.
 */

export interface SearchableConnector {
  slug: string
  name: string
  category: string
  description: string
  group: ConnectorGroup
  keywords: string[]
}

/** Lower case, accents removed, punctuation as spaces (keeps letters, digits, / . + #). */
export function normalizeSearch(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9/.+#]+/g, ' ')
    .trim()
}

export function connectorMatches(connector: SearchableConnector, query: string, extra: string[] = []) {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean)
  if (!tokens.length) return true
  const words = normalizeSearch([connector.name, connector.slug, connector.category, connector.description, connector.group, ...connector.keywords, ...extra].join(' ')).split(' ')
  return tokens.every((t) => words.some((w) => w.startsWith(t)))
}

/** Connectors by group, in the screen's group order; empty groups left out. */
export function groupConnectors<T extends { group: ConnectorGroup }>(items: T[]): { group: ConnectorGroup; items: T[] }[] {
  return CONNECTOR_GROUPS.map((group) => ({ group, items: items.filter((i) => i.group === group) })).filter((g) => g.items.length > 0)
}

export const isConnectorGroup = (value: unknown): value is ConnectorGroup => typeof value === 'string' && (CONNECTOR_GROUPS as readonly string[]).includes(value)
