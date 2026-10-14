/**
 * The in-app guide (Help & FAQ, /dashboard/help): chapters of blocks plus an
 * FAQ, written once per language in lib/help/content/{en,id}.ts with the same
 * ids (engine-tests compares them). Client-safe, no I/O.
 *
 * Inline text supports **bold**, *emphasis* and `code`; nothing else is interpreted.
 */
import type { Section } from '@/lib/navigation'
import type { Permission } from '@/lib/auth/permissions'
import type { HelpScreen } from './screens'

export type HelpDiagram = 'workflow' | 'architecture' | 'pipeline' | 'roles' | 'secrets'

export type HelpBlock =
  | { kind: 'p'; text: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'note'; tone: 'info' | 'warning'; text: string }
  | { kind: 'shot'; screen: HelpScreen; caption: string }
  | { kind: 'diagram'; diagram: HelpDiagram; caption: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; text: string }

export interface HelpSection {
  id: string
  title: string
  blocks: HelpBlock[]
}

export interface HelpChapter {
  /** Anchor on the page; tour steps link to it ("Read more"). */
  id: string
  title: string
  summary: string
  /** The screen this chapter is about ("Open …" button). */
  screen?: Section
  sections: HelpSection[]
}

export interface HelpFaq {
  id: string
  group: string
  q: string
  a: string
}

export interface HelpContent {
  chapters: HelpChapter[]
  faqGroups: { id: string; title: string }[]
  faqs: HelpFaq[]
  /** Labels for the diagrams (drawn in components/help/diagrams.tsx). */
  diagrams: {
    workflow: { stages: { title: string; body: string }[] }
    architecture: { network: string; cloud: string; consumers: string; systems: string; agent: string; nexus: string; products: string; api: string; secrets: string; outbound: string; direct: string }
    pipeline: { steps: { title: string; body: string }[]; quarantine: string; replay: string }
    secrets: { source: string; reference: string; manager: string; connect: string; note: string }
    /** One plain sentence per permission for the roles matrix. */
    roles: { permission: string; permissions: Record<Permission, string> }
  }
}
