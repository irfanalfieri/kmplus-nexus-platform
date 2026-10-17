/**
 * Who each guide section is for (Help & FAQ "Read as"): the permissions that
 * let a person do what the section explains. A section not listed is for
 * everyone. Pure and client-safe; engine-tests checks every key names a real
 * section and that every role has something to read.
 */
import { ROLES, can, type Permission, type Role } from '@/lib/auth/permissions'
import type { HelpChapter, HelpContent } from './types'

/** `${chapterId}.${sectionId}` → any one of these permissions. */
export const SECTION_ACCESS: Record<string, Permission[]> = {
  'connect.connectors': ['connectors:manage'],
  'connect.sources': ['sources:manage'],
  'connect.browse': ['data:preview'],
  'connect.files': ['sources:manage'],
  'connect.agent': ['workspace:manage'],
  'connect.intranet': ['sources:manage'],
  'connect.secrets': ['sources:manage'],
  'connect.infrastructure': ['sources:manage'],
  'connect.productivity': ['sources:manage'],
  'connect.destinations': ['sources:manage'],
  'pipelines.create': ['pipelines:edit'],
  'pipelines.editor': ['pipelines:edit'],
  'pipelines.lanes': ['pipelines:edit'],
  'pipelines.blocking': ['pipelines:edit'],
  'pipelines.api-steps': ['pipelines:edit'],
  'pipelines.mapping': ['pipelines:edit'],
  'pipelines.checks': ['pipelines:edit'],
  'pipelines.writing': ['pipelines:edit'],
  'pipelines.publish': ['pipelines:edit'],
  'pipelines.schedule': ['pipelines:run'],
  'pipelines.approvals': ['pipelines:approve', 'pipelines:edit'],
  'pipelines.environments': ['pipelines:edit'],
  'rules.conditions': ['rules:edit'],
  'rules.actions': ['rules:edit'],
  'rules.test-rule': ['rules:edit'],
  'rules.rules-ai': ['rules:edit'],
  'monitoring.retry': ['pipelines:run'],
  'quality.inbox': ['data:preview'],
  'quality.why-held': ['data:preview'],
  'quality.fix': ['quality:manage'],
  'quality.earlier': ['data:preview'],
  'catalog.document': ['catalog:edit'],
  'catalog.schemas': ['catalog:edit'],
  'catalog.live': ['data:preview'],
  'governance.masking': ['governance:manage'],
  'governance.row-filters': ['governance:manage'],
  'governance.retention': ['governance:manage', 'data:erase'],
  'governance.audit': ['audit:view'],
  'analytics.widget': ['dashboards:edit'],
  'analytics.ask': ['data:preview'],
  'api.keys': ['api:manage'],
  'api.read': ['api:manage'],
  'api.remote-run': ['api:manage'],
  'api.webhooks': ['api:manage'],
  'admin.sso': ['workspace:manage'],
  'admin.ai': ['workspace:manage'],
}

export const sectionKey = (chapter: string, section: string) => `${chapter}.${section}`

/** True when the role can do what the section explains. */
export function sectionFor(role: Role, chapter: string, section: string): boolean {
  const need = SECTION_ACCESS[sectionKey(chapter, section)]
  return !need || need.some((p) => can(role, p))
}

/** The roles a section is for (all six when it is for everyone). */
export function rolesFor(chapter: string, section: string): Role[] {
  return ROLES.filter((r) => sectionFor(r, chapter, section))
}

/** "Read as": the guide narrowed to one role, plus what was left out (listed, never silently dropped). */
export function guideFor(content: HelpContent, role: Role | 'all'): { chapters: HelpChapter[]; hidden: { chapter: HelpChapter; sections: HelpChapter['sections'] }[] } {
  if (role === 'all') return { chapters: content.chapters, hidden: [] }
  const chapters: HelpChapter[] = []
  const hidden: { chapter: HelpChapter; sections: HelpChapter['sections'] }[] = []
  for (const c of content.chapters) {
    const kept = c.sections.filter((s) => sectionFor(role, c.id, s.id))
    const left = c.sections.filter((s) => !sectionFor(role, c.id, s.id))
    if (kept.length) chapters.push({ ...c, sections: kept })
    if (left.length) hidden.push({ chapter: c, sections: left })
  }
  return { chapters, hidden }
}
