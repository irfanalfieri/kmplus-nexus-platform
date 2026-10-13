import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, workspaces } from '@/lib/db/schema'
import type { WorkspaceContext } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { AGENT_OFFLINE_AFTER_MS } from '@/lib/agent/protocol'
import { callAgent } from '@/lib/agent/server'
import { chatCompletion, extractJson, LlmError, type ChatMessage, type LlmConfig } from './llm'
import { AnswerError, repairMessages } from './prompts'

/**
 * The AI assistant's model (#14): an open-source model behind an
 * OpenAI-compatible API. A workspace chooses where it runs:
 *   server  the model configured for this Nexus (NEXUS_AI_BASE_URL, NEXUS_AI_MODEL,
 *           optional NEXUS_AI_API_KEY), e.g. Ollama/vLLM on your own server
 *   agent   the model next to one of the workspace's Nexus Agents (prompts never
 *           leave the customer's network)
 *   off
 */

export const AI_PROVIDERS = ['off', 'server', 'agent'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export function serverModel(): LlmConfig | null {
  const baseUrl = process.env.NEXUS_AI_BASE_URL?.trim()
  const model = process.env.NEXUS_AI_MODEL?.trim()
  return baseUrl && model ? { baseUrl, model, apiKey: process.env.NEXUS_AI_API_KEY?.trim() || undefined } : null
}

export interface AiStatus {
  provider: AiProvider
  ready: boolean
  model: string | null
  /** Where prompts go, for the UI ("this Nexus server", "agent Jakarta office"). */
  where: string
  message: string
  agentId: string | null
}

export async function aiStatus(workspaceId: string): Promise<AiStatus> {
  const [ws] = await db.select({ provider: workspaces.aiProvider, agentId: workspaces.aiAgentId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
  const provider = (AI_PROVIDERS as readonly string[]).includes(ws?.provider ?? '') ? (ws!.provider as AiProvider) : 'server'
  if (provider === 'off') return { provider, ready: false, model: null, where: '', message: 'The AI assistant is turned off for this workspace (Settings → AI assistant).', agentId: null }
  if (provider === 'agent') {
    const [agent] = ws?.agentId ? await db.select().from(agents).where(and(eq(agents.id, ws.agentId), eq(agents.workspaceId, workspaceId), isNull(agents.revokedAt))).limit(1) : []
    const model = (agent?.ai as { model?: string } | null)?.model ?? null
    if (!agent) return { provider, ready: false, model: null, where: '', message: 'Choose the agent whose model to use (Settings → AI assistant).', agentId: null }
    if (!model) return { provider, ready: false, model: null, where: `agent ${agent.name}`, message: `Agent "${agent.name}" has no AI model in its config.`, agentId: agent.id }
    const online = Boolean(agent.lastSeenAt) && Date.now() - agent.lastSeenAt!.getTime() < AGENT_OFFLINE_AFTER_MS
    return { provider, ready: online, model, where: `agent ${agent.name}`, message: online ? '' : `Agent "${agent.name}" is offline.`, agentId: agent.id }
  }
  const cfg = serverModel()
  if (!cfg) return { provider, ready: false, model: null, where: 'this Nexus server', message: 'No AI model is configured for this Nexus (NEXUS_AI_BASE_URL and NEXUS_AI_MODEL), and no agent model is selected.', agentId: null }
  return { provider, ready: true, model: cfg.model, where: `this Nexus server (${new URL(cfg.baseUrl).host})`, message: '', agentId: null }
}

async function complete(ctx: WorkspaceContext, status: AiStatus, messages: ChatMessage[]): Promise<string> {
  if (status.provider === 'agent') {
    const res = (await callAgent(status.agentId!, 'ai', { messages, json: true, temperature: 0.1, maxTokens: 2000 }, { workspaceId: ctx.workspaceId, timeoutMs: 150_000 })) as { content: string }
    return res.content
  }
  return (await chatCompletion(serverModel()!, messages, { json: true, temperature: 0.1, maxTokens: 2000, timeoutMs: 120_000 })).content
}

/**
 * Asks the model and checks the answer; one retry with the problem explained.
 * Audits the feature, model and outcome (never the prompt or data).
 */
export async function askModel<T>(ctx: WorkspaceContext, feature: 'mapping' | 'rule' | 'ask' | 'pipeline' | 'diagnosis', messages: ChatMessage[], check: (answer: unknown) => T): Promise<{ value: T; model: string }> {
  const status = await aiStatus(ctx.workspaceId)
  if (!status.ready) throw new Error(status.message)
  let conversation = messages
  let lastProblem = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const content = await complete(ctx, status, conversation)
    try {
      const value = check(extractJson(content))
      await recordAudit(ctx, { action: 'AI_ASSIST', resource: 'ai', resourceId: feature, changes: { feature, model: status.model, where: status.where, attempts: attempt } })
      return { value, model: status.model! }
    } catch (err) {
      if (!(err instanceof AnswerError || err instanceof LlmError)) throw err
      lastProblem = err.message
      conversation = [...messages, ...repairMessages(content, err.message)]
    }
  }
  await recordAudit(ctx, { action: 'AI_ASSIST', resource: 'ai', resourceId: feature, changes: { feature, model: status.model, where: status.where, attempts: 2, failed: lastProblem.slice(0, 200) } })
  throw new Error(`The AI model's answer couldn't be used (${lastProblem}) Try rephrasing, or use a larger model.`)
}
