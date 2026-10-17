/**
 * Data source health and schema drift (DS-7 / DS-8). Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { affectedPipelines, describeChange, diffScans, driftFrom, isBreaking, mergeDrift, uptime } from '@/lib/connectors/drift'
import type { SchemaScanResult } from '@/lib/connectors/types'
import { ROOT_CAUSES, rootCause } from '@/lib/monitoring/root-cause'
import { hints } from '@/lib/i18n/messages/en/hints'
import { AGENT_CAPABLE, WRITE_CAPABLE, connectorCapabilities } from '@/lib/connectors/capabilities'
import { WRITABLE_CONNECTORS } from '@/lib/pipelines/io'
import { AGENT_CONNECTOR_TYPES } from '@/lib/agent/protocol'
import { CONNECTOR_CATALOG } from '@/lib/connectors/catalog'
import { connectorDocs as docsEn } from '@/lib/i18n/messages/en/connectorDocs'
import { connectorDocs as docsId } from '@/lib/i18n/messages/id/connectorDocs'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>
const NL = String.fromCharCode(10)

const scan = (tables: Record<string, [string, string][]>, at = '2026-10-17T00:00:00Z'): SchemaScanResult => ({
  scannedAt: at,
  method: 'test',
  tables: Object.entries(tables).map(([name, cols]) => ({ schema: 'public', name, rowCount: null, columns: cols.map(([n, type]) => ({ name: n, type, nullable: true })) })),
})

export async function healthTests(test: Test) {
  await test('drift: removed / added tables and columns, type changes by family (varchar(50) = text)', () => {
    const before = scan({ employees: [['id', 'integer'], ['name', 'character varying(50)'], ['birth', 'date'], ['grade', 'integer']], orgs: [['code', 'text']] })
    const after = scan({ employees: [['id', 'bigint'], ['name', 'text'], ['birth', 'timestamp without time zone'], ['email', 'text']], payroll: [['id', 'int']] }, '2026-10-17T06:00:00Z')
    const changes = diffScans(before, after)
    assert.deepEqual(changes.map(describeChange), [
      'employees.birth changed from date to timestamp without time zone',
      'employees.grade removed',
      'employees.email added (text)',
      'Table orgs removed',
      'Table payroll added',
    ])
    assert.deepEqual(changes.filter(isBreaking).length, 3)
    assert.deepEqual(diffScans(null, after), [], 'a first scan has nothing to compare')
    assert.deepEqual(diffScans(before, before), [])
  })

  await test('drift: pipelines reading a removed table, or naming a removed / retyped column, are listed', () => {
    const before = scan({ employees: [['id', 'integer'], ['grade', 'integer'], ['bonus', 'numeric']], orgs: [['code', 'text']] })
    const after = scan({ employees: [['id', 'integer'], ['bonus', 'text']] })
    const pipelines = [
      { id: 'p1', name: 'Grades', definition: { nodes: [{ id: 's', type: 'source', dataSourceId: 'ds1', table: 'employees' }, { id: 'm', type: 'map', fields: [{ from: 'grade', to: 'level' }] }] } },
      { id: 'p2', name: 'Pass-through', definition: { nodes: [{ id: 's', type: 'source', dataSourceId: 'ds1', table: 'employees' }, { id: 'd', type: 'destination' }] } },
      { id: 'p3', name: 'Orgs', definition: { nodes: [{ id: 's', type: 'source', dataSourceId: 'ds1', table: 'orgs' }] } },
      { id: 'p4', name: 'Other source', definition: { nodes: [{ id: 's', type: 'source', dataSourceId: 'ds2', table: 'employees' }, { id: 'm', type: 'map', fields: [{ from: 'grade' }] }] } },
    ]
    const affected = affectedPipelines('ds1', diffScans(before, after), pipelines as never)
    assert.deepEqual(affected, [
      { pipelineId: 'p1', name: 'Grades', changes: ['employees.grade removed'] },
      { pipelineId: 'p3', name: 'Orgs', changes: ['Table orgs removed'] },
    ])
    // Only additions: nothing kept.
    assert.equal(driftFrom('ds1', after, scan({ employees: [['id', 'integer'], ['bonus', 'text'], ['team', 'text']] }), pipelines as never), null)
    const d1 = driftFrom('ds1', before, after, pipelines as never, new Date('2026-10-17T06:00:00Z'))!
    assert.equal(d1.from, '2026-10-17T00:00:00Z')
    // A later drift merges with one not reviewed yet.
    const d2 = driftFrom('ds1', after, scan({ employees: [['id', 'integer']] }, '2026-10-17T12:00:00Z'), pipelines as never)!
    const merged = mergeDrift(d1, d2)!
    assert.equal(merged.from, '2026-10-17T00:00:00Z')
    assert.ok(merged.changes.map(describeChange).includes('employees.bonus removed') && merged.changes.map(describeChange).includes('Table orgs removed'))
    assert.equal(mergeDrift(d1, null), d1)
  })

  await test('health: uptime over a window', () => {
    const now = Date.parse('2026-10-17T12:00:00Z')
    const checks = [
      { ok: true, checkedAt: '2026-10-17T11:45:00Z' },
      { ok: false, checkedAt: '2026-10-17T11:30:00Z' },
      { ok: true, checkedAt: '2026-10-17T11:15:00Z' },
      { ok: true, checkedAt: '2026-10-15T11:00:00Z' },
    ]
    assert.deepEqual(uptime(checks, 86_400_000, now), { checks: 3, ok: 2, percent: 66.7 })
    assert.deepEqual(uptime(checks, 7 * 86_400_000, now), { checks: 4, ok: 3, percent: 75 })
    assert.deepEqual(uptime([], 86_400_000, now), { checks: 0, ok: 0, percent: null })
  })

  await test('root-cause hints: database, HTTP, agent and Nexus messages map to a cause with a fix', () => {
    const cases: [string, string | null][] = [
      ['password authentication failed for user "hr_reader"', 'auth'],
      ['The API refused the sign-in (HTTP 401): token expired', 'auth'],
      ['permission denied for table payroll', 'permission'],
      ['HTTP 403 Forbidden', 'permission'],
      ['column "legacy_grade" does not exist', 'schemaDrift'],
      ['relation "public.employees" does not exist', 'schemaDrift'],
      ["Invalid object name 'dbo.Karyawan'.", 'schemaDrift'],
      ['invalid input syntax for type integer: "abc"', 'dataType'],
      ['canceling statement due to statement timeout', 'timeout'],
      ['connect ECONNREFUSED 10.0.0.5:5432', 'network'],
      ['getaddrinfo ENOTFOUND hr.example.co.id', 'network'],
      ['self-signed certificate in certificate chain', 'network'],
      ['HTTP 429 Too Many Requests', 'rateLimit'],
      ['Nexus Agent "HQ" is offline (last seen 2 hours ago). Start it on its host, then try again.', 'agent'],
      ['10.1.2.3 is a private or intranet address and is refused from the cloud. Use a Nexus Agent.', 'privateNetwork'],
      ['The API answered 503 Service Unavailable', 'remoteError'],
      ['Stopped: the quarantine threshold (5%) was exceeded', 'held'],
      ['Something odd happened', null],
      ['', null],
    ]
    for (const [message, expected] of cases) assert.equal(rootCause(message), expected, message)
    // Every cause has words to show.
    for (const c of ROOT_CAUSES) assert.ok(hints.causes[c].title && hints.causes[c].fix, c)
  })


  await test('connector detail pages: capabilities match the writers and the agent; every connector has permissions in both languages', () => {
    assert.deepEqual([...WRITE_CAPABLE].sort(), [...WRITABLE_CONNECTORS].sort())
    assert.deepEqual([...AGENT_CAPABLE].sort(), [...AGENT_CONNECTOR_TYPES].sort())
    for (const c of CONNECTOR_CATALOG) {
      const en = (docsEn.connectors as Record<string, { permissions: string }>)[c.slug]
      const id = (docsId.connectors as Record<string, { permissions: string }>)[c.slug]
      assert.ok(en?.permissions && id?.permissions, `permissions for ${c.slug}`)
      assert.equal(en.permissions.split(NL).length, id.permissions.split(NL).length, `same number of permissions for ${c.slug}`)
    }
    assert.equal(connectorCapabilities('vault').read, 'no')
    assert.equal(connectorCapabilities('postgres').write, 'yes')
    assert.equal(connectorCapabilities('rest').incremental, 'partial')
    assert.equal(connectorCapabilities('file').agent, 'no')
  })

}
