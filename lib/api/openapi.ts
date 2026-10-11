import { API_OPERATORS, DEFAULT_LIMIT, MAX_LIMIT } from './query'
import { DOMAIN_ENTITIES } from '@/lib/domain/model'

/** OpenAPI 3.1 description of the Nexus Data API (API-6). Served at /api/v1/openapi.json. */
export function openApiSpec(origin: string) {
  const err = { $ref: '#/components/responses/Error' }
  const page = (item: object) => ({
    type: 'object',
    required: ['data', 'next_cursor'],
    properties: { data: { type: 'array', items: item }, next_cursor: { type: ['string', 'null'], description: 'Pass as `cursor` to get the next page; null on the last page.' }, meta: { type: 'object', additionalProperties: true } },
  })
  const listParams = [
    { name: 'fields', in: 'query', schema: { type: 'string' }, description: 'Comma-separated fields to return.', example: 'employee_code,full_name' },
    { name: 'filter[field]', in: 'query', schema: { type: 'string' }, description: `Equality filter; or \`filter[field][op]=value\` with op in ${API_OPERATORS.join(', ')} (\`in\` takes a comma-separated list). Masked fields can't be filtered.` },
    { name: 'updated_since', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Only rows loaded at or after this time.' },
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT } },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
  ]
  const run = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      pipeline_id: { type: 'string' },
      status: { type: 'string', enum: ['queued', 'running', 'success', 'partial', 'failed', 'cancelled'] },
      trigger: { type: 'string', enum: ['manual', 'schedule', 'api', 'webhook', 'chain', 'replay'] },
      pipeline_version: { type: 'integer' },
      rows_read: { type: 'integer' },
      rows_written: { type: 'integer' },
      rows_quarantined: { type: 'integer' },
      error: { type: ['string', 'null'] },
      started_at: { type: ['string', 'null'], format: 'date-time' },
      finished_at: { type: ['string', 'null'], format: 'date-time' },
      duration_seconds: { type: ['integer', 'null'] },
    },
  }
  const event = (name: string, data: object) => ({
    post: {
      summary: name,
      description: 'Signed with your webhook secret: header `Nexus-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. Reject timestamps older than 5 minutes. Respond 2xx within 10 s; failures are retried (1 min, 5 min, 30 min, 2 h).',
      parameters: [
        { name: 'Nexus-Event', in: 'header', schema: { type: 'string', const: name } },
        { name: 'Nexus-Delivery', in: 'header', schema: { type: 'string' } },
        { name: 'Nexus-Signature', in: 'header', schema: { type: 'string' } },
      ],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' }, event: { const: name }, created_at: { type: 'string', format: 'date-time' }, workspace_id: { type: 'string' }, data } } } } },
      responses: { '2XX': { description: 'Received' } },
    },
  })

  return {
    openapi: '3.1.0',
    info: {
      title: 'KMPlus Nexus Data API',
      version: '1.0.0',
      description:
        'Read workspace datasets and Unified Data Model entities, trigger pipelines and follow their runs. Create keys in Workspace settings → Data API keys. Personal data is masked and row-level policies apply according to the key\'s role. Each key may make its configured number of requests per minute (default 120); responses carry X-RateLimit-Limit / -Remaining / -Reset, and 429 responses a Retry-After header.',
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ apiKey: [] }],
    paths: {
      '/datasets': {
        get: { summary: 'List readable datasets', description: 'Scope `datasets:read`.', responses: { 200: { description: 'Datasets', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, mode: { enum: ['cached', 'live'] }, fields: { type: ['array', 'null'], items: { type: 'string' } }, row_count: { type: ['integer', 'null'] }, last_loaded_at: { type: ['string', 'null'] } } } } } } } } }, 401: err, 429: err } },
      },
      '/datasets/{name}': {
        get: {
          summary: 'Read a dataset',
          description: 'Scope `datasets:read`. Rows in a stable order, paged with `cursor`. Live catalog tables (published names) return one page up to their row limit and support only equality filters.',
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }, ...listParams],
          responses: { 200: { description: 'One page of rows', content: { 'application/json': { schema: page({ type: 'object', additionalProperties: true }) } } }, 400: err, 401: err, 403: err, 404: err, 429: err },
        },
      },
      '/domains/{entity}': {
        get: {
          summary: 'Read a business entity',
          description: 'Scope `domains:read`. Rows of the dataset published as this entity, with canonical field names.',
          parameters: [{ name: 'entity', in: 'path', required: true, schema: { type: 'string', enum: DOMAIN_ENTITIES.map((e) => e.name) } }, ...listParams],
          responses: { 200: { description: 'One page of entity records', content: { 'application/json': { schema: page({ type: 'object', additionalProperties: true }) } } }, 400: err, 401: err, 404: err, 429: err },
        },
      },
      '/pipelines': {
        get: { summary: 'List pipelines', description: 'Scope `runs:read` or `pipelines:run`.', responses: { 200: { description: 'Pipelines' }, 401: err, 429: err } },
      },
      '/pipelines/{id}/runs': {
        post: {
          summary: 'Run a pipeline',
          description: 'Scope `pipelines:run`. Queues a run of the published version; it runs in the background. Returns 409 when the pipeline is already queued or running.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 202: { description: 'Queued', content: { 'application/json': { schema: { type: 'object', properties: { run_id: { type: 'string' }, status: { const: 'queued' }, status_url: { type: 'string' } } } } } }, 401: err, 403: err, 404: err, 409: err, 429: err },
        },
        get: { summary: 'Latest runs of a pipeline', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } }], responses: { 200: { description: 'Runs', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: run } } } } } }, 401: err, 429: err } },
      },
      '/runs/{id}': {
        get: { summary: 'Run status', description: 'Scope `runs:read` or `pipelines:run`. Poll until status is success, partial, failed or cancelled, or subscribe to webhooks instead.', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Run', content: { 'application/json': { schema: { type: 'object', properties: { data: run } } } } }, 401: err, 404: err, 429: err } },
      },
    },
    webhooks: {
      'run.succeeded': event('run.succeeded', { type: 'object', properties: { run } }),
      'run.failed': event('run.failed', { type: 'object', properties: { run } }),
      'dataset.updated': event('dataset.updated', { type: 'object', properties: { dataset: { type: 'string' }, row_count: { type: 'integer' }, rows_written: { type: 'integer' }, run_id: { type: 'string' }, pipeline_id: { type: 'string' } } }),
    },
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'nxk_…', description: 'Workspace API key' } },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { status: { type: 'integer' }, message: { type: 'string' } } } } } } } } },
    },
    'x-inbound-webhook': {
      description: `Pipelines can also be started by POST ${origin}/api/hooks/pipelines/{pipelineId}/{token} (a secret URL created in the pipeline's Schedule tab, 30 requests per minute). No API key needed.`,
    },
  }
}
