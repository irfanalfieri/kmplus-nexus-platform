import Anthropic from '@anthropic-ai/sdk'
import { LlmError, type ChatMessage } from './llm'
import { FALLBACK_MODELS, type PaidModelConfig } from './model-config'

/**
 * The paid model path (NEXUS_AI_MODEL_TYPE=paid): Anthropic's Claude through
 * the official SDK. Server only, never bundled into the Nexus Agent (whose
 * model stays open-source). Same contract as chatCompletion: messages in, the
 * answer's text out; callers parse JSON with extractJson and check it.
 *
 * Current Claude models take no temperature and choose their own thinking;
 * depth is set with effort. Refusals come back as stop_reason "refusal"; on
 * models that support it the server re-runs a refused request on a fallback
 * model ("default" routing).
 */

export interface PaidChatOptions {
  maxTokens?: number
  timeoutMs?: number
  /** Tests: a stand-in for the network. */
  fetchImpl?: typeof fetch
}

export async function paidCompletion(config: PaidModelConfig, messages: ChatMessage[], opts: PaidChatOptions = {}): Promise<{ content: string; model: string }> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': config.workspaceId } } : {}),
    timeout: opts.timeoutMs ?? 120_000,
    maxRetries: 2,
    ...(opts.fetchImpl ? { fetch: opts.fetchImpl } : {}),
  })
  // The Messages API takes the system prompt separately; the conversation alternates user / assistant.
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const turns: Anthropic.Beta.BetaMessageParam[] = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const withFallback = FALLBACK_MODELS.has(config.model)

  let response: Anthropic.Beta.BetaMessage
  try {
    response = await client.beta.messages.create({
      model: config.model,
      // Thinking counts against max_tokens: leave room for it on top of the answer.
      max_tokens: Math.max(opts.maxTokens ?? 0, 16_000),
      ...(system ? { system } : {}),
      messages: turns,
      output_config: { effort: config.effort },
      ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new LlmError('The paid AI model refused the API key (NEXUS_AI_PAID_API_KEY). Check the key and its workspace in the Claude Console.')
    }
    if (err instanceof Anthropic.NotFoundError) throw new LlmError(`The paid AI model "${config.model}" was not found. Check NEXUS_AI_PAID_MODEL.`)
    if (err instanceof Anthropic.RateLimitError) throw new LlmError('The paid AI model is rate limited or out of credit right now. Try again shortly, or check the Claude Console.')
    if (err instanceof Anthropic.BadRequestError) {
      const detail = apiMessage(err)
      if (/anthropic-workspace-id/i.test(detail)) {
        throw new LlmError("The paid AI model needs a workspace: this API key isn't scoped to one. Set NEXUS_AI_PAID_WORKSPACE_ID to the workspace ID from the Claude Console, or use a key created in a workspace.")
      }
      throw new LlmError(`The paid AI model rejected the request: ${detail.slice(0, 300)}`)
    }
    if (err instanceof Anthropic.APIConnectionError) throw new LlmError('The paid AI model did not answer (network error or timeout).')
    if (err instanceof Anthropic.APIError) throw new LlmError(`The paid AI model returned HTTP ${err.status ?? 'error'}.`)
    throw err
  }
  if (response.stop_reason === 'refusal') throw new LlmError('The paid AI model declined to answer this request.')
  const content = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  if (!content.trim()) {
    throw new LlmError(response.stop_reason === 'max_tokens' ? 'The paid AI model ran out of room before answering. Try a lower NEXUS_AI_PAID_EFFORT.' : 'The paid AI model returned no answer.')
  }
  return { content, model: response.model }
}

/** The API's own error text (`error.message` in the body), not the SDK's "400 {json}" form. */
function apiMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: unknown } } | undefined
  return typeof body?.error?.message === 'string' ? body.error.message : err.message
}
