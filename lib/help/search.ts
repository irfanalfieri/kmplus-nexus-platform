/** Search over the guide (pure, client-safe): every word of the query must appear, ignoring case and accents. */
import type { HelpBlock } from './types'

const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[*`]/g, '')
    .toLowerCase()

export function matchesQuery(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold(text)
  return words.every((w) => hay.includes(w))
}

/** The searchable words of a block (captions included, diagrams by caption). */
export function blockText(block: HelpBlock): string {
  switch (block.kind) {
    case 'p':
    case 'note':
    case 'code':
      return block.text
    case 'list':
    case 'steps':
      return block.items.join(' ')
    case 'table':
      return [...block.head, ...block.rows.flat()].join(' ')
    case 'shot':
    case 'diagram':
      return block.caption
  }
}
