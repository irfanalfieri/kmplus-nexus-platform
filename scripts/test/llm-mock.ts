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
      } else if (system.startsWith('You plan a KMPlus Nexus data pipeline')) {
        // The first listed source table with columns; keep rows where its first column is filled.
        const m = /- id "([^"]+)": [^\n]*?tables: ([^ ;[]+) \[([^\]]*)\]/.exec(system)
        const columns = (m?.[3] ?? '').split(', ').filter(Boolean)
        answer = {
          name: 'People copy',
          description: 'Copies the people table every morning.',
          template: 'csv-dataset',
          dataSourceId: m?.[1] ?? 'missing',
          table: m?.[2] ?? 'missing',
          datasetName: 'people_copy',
          kmplusDestinationId: '',
          filter: columns[0] ? { match: 'all', conditions: [{ field: columns[0], operator: 'is_not_empty', value: '' }] } : null,
          schedule: { type: 'daily', time: '02:00' },
          explanation: 'Reads the table and writes a dataset daily at 02:00 WIB.',
        }
      } else if (system.startsWith('You recommend which KMPlus Nexus connector')) {
        answer = { suggestions: [{ slug: 'rest', confidence: 'medium', reason: 'An HTTP API is the closest fit.' }] }
      } else if (system.startsWith('You find where data lives')) {
        // The first listed item, with one real and one invented column.
        const list = JSON.parse(system.slice(system.lastIndexOf('\n[') + 1)) as { key: string; columns: string[] }[]
        const first = list[0]
        answer = { results: first ? [{ key: first.key, columns: [first.columns[0]?.split(':')[0] ?? '', 'not_a_column'], reason: 'It holds the people.' }] : [] }
      } else if (system.startsWith('You diagnose')) {
        const input = JSON.parse(user) as { steps: { id: string; type: string; detail: string }[] }
        const map = input.steps.find((s) => s.type === 'map')
        const target = map ? /→([A-Za-z_][A-Za-z0-9_]*):/.exec(map.detail)?.[1] : undefined
        answer = {
          summary: 'Some rows failed the email check.',
          cause: 'The source has addresses with surrounding spaces.',
          steps: ['Trim the field in the Map step.', 'Replay the held rows.'],
          fix: map && target ? { kind: 'add_transform', stepId: map.id, field: target, transform: { fn: 'trim', args: [] } } : { kind: 'none' },
        }
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
