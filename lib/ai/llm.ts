/**
 * Chat completions against any OpenAI-compatible endpoint serving an
 * open-source model (#14): Ollama (http://localhost:11434/v1), vLLM, LM Studio,
 * llama.cpp server, or hosted open-model APIs (Groq, OpenRouter, Together…).
 * Used by the Nexus server (NEXUS_AI_*) and by the Nexus Agent (a model next to
 * the customer's data). No SDK: one fetch.
 */

export interface LlmConfig {
  /** Base URL including /v1, e.g. http://localhost:11434/v1 */
  baseUrl: string
  model: string
  apiKey?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  /** Ask for a JSON object (response_format json_object; Ollama and vLLM honour it). */
  json?: boolean
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class LlmError extends Error {}

export async function chatCompletion(config: LlmConfig, messages: ChatMessage[], opts: ChatOptions = {}): Promise<{ content: string; model: string }> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body = {
    model: config.model,
    messages,
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 1500,
    stream: false,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000)
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    const reason = err instanceof Error && err.name === 'AbortError' ? 'timed out' : err instanceof Error ? err.message : 'network error'
    throw new LlmError(`The AI model at ${new URL(url).host} did not answer (${reason}).`)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  if (!res.ok) throw new LlmError(`The AI model returned HTTP ${res.status}: ${text.slice(0, 300)}`)
  let data: { choices?: { message?: { content?: string } }[]; model?: string }
  try {
    data = JSON.parse(text)
  } catch {
    throw new LlmError('The AI model returned something that is not JSON.')
  }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new LlmError('The AI model returned no answer.')
  return { content, model: data.model ?? config.model }
}

/**
 * The JSON object in a model's answer. Small models sometimes wrap it in
 * ```json fences or add a sentence around it, so take the outermost {...}.
 */
export function extractJson(content: string): unknown {
  const trimmed = content.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]
  if (fenced) {
    try {
      return JSON.parse(fenced.trim())
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      // fall through
    }
  }
  throw new LlmError('The AI answer was not valid JSON. Try again or rephrase.')
}
