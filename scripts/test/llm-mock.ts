import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * A stand-in for an OpenAI-compatible open-source model server (Ollama, vLLM)
 * for the AI assistant tests. It answers each of the assistant's prompts with
 * canned JSON (the rule prompt is first answered wrongly, to exercise the
 * repair round) and records every request so tests can check what was sent.
 */
export async function startLlmMock(port = 0) {
  const requests: { model: string; messages: { role: string; content: string }[]; response_format?: unknown }[] = []
  let ruleCalls = 0
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
        res.writeHead(404).end()
        return
      }
      const body = JSON.parse(raw) as (typeof requests)[number]
      requests.push(body)
      const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
      const user = body.messages.filter((m) => m.role === 'user')[0]?.content ?? ''
      let answer: unknown
      if (system.startsWith('You map columns')) {
        const cols = (JSON.parse(user) as { sourceColumns: { name: string }[] }).sourceColumns.map((c) => c.name)
        answer = {
          fields: [
            ...(cols.includes('id') ? [{ from: 'id', to: 'employee_code', type: 'text', transforms: [{ fn: 'trim', args: [] }], reason: 'numeric id is the employee code' }] : []),
            ...(cols.includes('email') ? [{ from: 'email', to: 'email', type: 'text', transforms: [{ fn: 'lowercase' }, { fn: 'not_a_transform' }], reason: 'same name' }] : []),
            { from: 'NOT_A_COLUMN', to: 'full_name', type: 'text', reason: 'invented' },
            { from: 'id', to: 'Bad Name!', type: 'text' },
          ],
        }
      } else if (system.startsWith('You turn a business rule')) {
        ruleCalls++
        const field = ruleCalls === 1 ? 'salary' : 'email'
        answer = {
          name: 'Kmplus emails only',
          description: 'Keep people with a company email.',
          body: { when: { match: 'all', conditions: [{ field, operator: 'ends_with', value: '@kmplus.test', valueField: '' }], groups: [] }, then: [{ type: 'include' }], otherwise: [{ type: 'exclude' }] },
        }
      } else if (system.startsWith('You answer questions')) {
        const ds = (JSON.parse(user) as { datasets: { name: string }[] }).datasets[0]?.name
        answer = { widget: { dataset: ds, type: 'kpi', title: 'People', measure: { agg: 'count', column: '' }, dimension: {}, filters: [], sort: 'value_desc', limit: 10 }, explanation: 'Counts the rows of the dataset.' }
      } else {
        answer = { ok: true }
      }
      // Small models often wrap JSON in a code fence; the assistant must cope.
      const content = '```json\n' + JSON.stringify(answer) + '\n```'
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'mock', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content } }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const bound = (server.address() as AddressInfo).port
  return { baseUrl: `http://127.0.0.1:${bound}/v1`, requests, stop: () => new Promise<void>((r) => server.close(() => r())) }
}
