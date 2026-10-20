import type { LlmConfig } from './llm'

/**
 * Which model this Nexus server's AI assistant uses (#14). Two setups live
 * side by side, chosen by NEXUS_AI_MODEL_TYPE:
 *
 *   opensource (default)  an open-source model behind an OpenAI-compatible API
 *                         NEXUS_AI_BASE_URL, NEXUS_AI_MODEL, optional NEXUS_AI_API_KEY
 *   paid                  a paid model API; today Anthropic's Claude
 *                         NEXUS_AI_PAID_API_KEY (required), NEXUS_AI_PAID_PROVIDER (anthropic),
 *                         NEXUS_AI_PAID_MODEL (default claude-opus-5-5),
 *                         NEXUS_AI_PAID_EFFORT (low … max, default medium),
 *                         NEXUS_AI_PAID_WORKSPACE_ID (optional: the Claude Console workspace,
 *                         needed when the key isn't scoped to one),
 *                         NEXUS_AI_PAID_BASE_URL (optional, e.g. a company gateway)
 *
 * Switching the type never touches the other set, so both can stay configured.
 * A model next to a Nexus Agent is separate (Settings → AI assistant) and always
 * open-source. Pure: reads only the env object it is given.
 */

export const MODEL_TYPES = ['opensource', 'paid'] as const
export type ModelType = (typeof MODEL_TYPES)[number]
export const PAID_PROVIDERS = ['anthropic'] as const
export type PaidProvider = (typeof PAID_PROVIDERS)[number]
export const PAID_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type PaidEffort = (typeof PAID_EFFORTS)[number]
export const DEFAULT_PAID_MODEL = 'claude-opus-5-5'

export interface PaidModelConfig {
  provider: PaidProvider
  apiKey: string
  model: string
  effort: PaidEffort
  /** Sent as anthropic-workspace-id, for API keys that aren't scoped to a workspace. */
  workspaceId?: string
  baseUrl?: string
}

export type ServerModel = { type: 'opensource'; config: LlmConfig } | { type: 'paid'; config: PaidModelConfig }

type Env = Record<string, string | undefined>
const read = (env: Env, name: string) => env[name]?.trim() || undefined

/** The configured server model, or why there is none (English, shown in Settings). */
export function readServerModel(env: Env = process.env): { model: ServerModel | null; type: ModelType | null; problem: string | null } {
  const rawType = (read(env, 'NEXUS_AI_MODEL_TYPE') ?? 'opensource').toLowerCase().replace(/[-_\s]/g, '')
  if (rawType !== 'opensource' && rawType !== 'paid') {
    return { model: null, type: null, problem: `NEXUS_AI_MODEL_TYPE must be "opensource" or "paid" (it is "${read(env, 'NEXUS_AI_MODEL_TYPE')}").` }
  }
  if (rawType === 'opensource') {
    const baseUrl = read(env, 'NEXUS_AI_BASE_URL')
    const model = read(env, 'NEXUS_AI_MODEL')
    if (!baseUrl || !model) return { model: null, type: 'opensource', problem: 'No AI model is configured for this Nexus (NEXUS_AI_BASE_URL and NEXUS_AI_MODEL), and no agent model is selected.' }
    return { model: { type: 'opensource', config: { baseUrl, model, apiKey: read(env, 'NEXUS_AI_API_KEY') } }, type: 'opensource', problem: null }
  }
  const provider = (read(env, 'NEXUS_AI_PAID_PROVIDER') ?? 'anthropic').toLowerCase()
  if (!(PAID_PROVIDERS as readonly string[]).includes(provider)) {
    return { model: null, type: 'paid', problem: `NEXUS_AI_PAID_PROVIDER "${provider}" isn't supported. Supported: ${PAID_PROVIDERS.join(', ')}.` }
  }
  const apiKey = read(env, 'NEXUS_AI_PAID_API_KEY')
  if (!apiKey) return { model: null, type: 'paid', problem: 'NEXUS_AI_MODEL_TYPE is "paid" but NEXUS_AI_PAID_API_KEY is not set.' }
  const effort = (read(env, 'NEXUS_AI_PAID_EFFORT') ?? 'medium').toLowerCase()
  if (!(PAID_EFFORTS as readonly string[]).includes(effort)) {
    return { model: null, type: 'paid', problem: `NEXUS_AI_PAID_EFFORT must be one of ${PAID_EFFORTS.join(', ')} (it is "${effort}").` }
  }
  return {
    model: {
      type: 'paid',
      config: { provider: provider as PaidProvider, apiKey, model: read(env, 'NEXUS_AI_PAID_MODEL') ?? DEFAULT_PAID_MODEL, effort: effort as PaidEffort, workspaceId: read(env, 'NEXUS_AI_PAID_WORKSPACE_ID'), baseUrl: read(env, 'NEXUS_AI_PAID_BASE_URL') },
    },
    type: 'paid',
    problem: null,
  }
}

/** Models that accept the server-side refusal fallback in its "default" form (Claude API). */
export const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])
