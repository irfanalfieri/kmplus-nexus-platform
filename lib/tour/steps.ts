/**
 * "Guide me": the guided tour through the workflow, one step per feature, in
 * the order work actually flows (connect → build → operate → govern → analyze →
 * administer). Each step opens its screen and points at a real control marked
 * with data-tour="…"; when that control isn't on screen (role, empty workspace)
 * the step points at the screen's title instead and says so. Client-safe.
 */

export const TOUR_STAGES = ['home', 'connect', 'build', 'operate', 'govern', 'analyze'] as const
export type TourStage = (typeof TOUR_STAGES)[number]

export interface TourStep {
  id: string
  stage: TourStage
  /** The screen the step opens. */
  route: string
  /** data-tour marker of the control to point at; none = the screen title. */
  target?: string
  /** Chapter of the help page for "Read more". */
  doc: string
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', stage: 'home', route: '/dashboard/overview', doc: 'start' },
  { id: 'lines', stage: 'home', route: '/dashboard/overview', target: 'overview-lines', doc: 'start' },
  { id: 'needs', stage: 'home', route: '/dashboard/overview', target: 'overview-needs', doc: 'start' },
  { id: 'connectors', stage: 'connect', route: '/dashboard/connectors', target: 'connectors-find', doc: 'connect' },
  { id: 'sources', stage: 'connect', route: '/dashboard/sources', target: 'sources-add', doc: 'connect' },
  { id: 'pipelinesNew', stage: 'build', route: '/dashboard/pipelines', target: 'pipelines-new', doc: 'pipelines' },
  { id: 'pipelinesBoard', stage: 'build', route: '/dashboard/pipelines', target: 'pipelines-board', doc: 'pipelines' },
  { id: 'rules', stage: 'build', route: '/dashboard/rules', target: 'rules-new', doc: 'rules' },
  { id: 'monitoring', stage: 'operate', route: '/dashboard/monitoring', target: 'monitoring-health', doc: 'monitoring' },
  { id: 'quality', stage: 'operate', route: '/dashboard/quality', target: 'quality-inbox', doc: 'quality' },
  { id: 'catalog', stage: 'govern', route: '/dashboard/catalog', target: 'catalog-search', doc: 'catalog' },
  { id: 'governance', stage: 'govern', route: '/dashboard/governance', target: 'governance-policies', doc: 'governance' },
  { id: 'analytics', stage: 'analyze', route: '/dashboard/analytics', target: 'analytics-dashboards', doc: 'analytics' },
  { id: 'settings', stage: 'analyze', route: '/dashboard/settings', target: 'settings-tabs', doc: 'admin' },
  { id: 'jump', stage: 'analyze', route: '/dashboard/settings', target: 'jump-to', doc: 'start' },
  { id: 'finish', stage: 'analyze', route: '/dashboard/settings', target: 'help-button', doc: 'faq' },
]

export const tourStepIndex = (id: string) => TOUR_STEPS.findIndex((s) => s.id === id)
