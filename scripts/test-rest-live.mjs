import {
  REST_DEFAULTS,
  testRestConfig,
  scanRestConfig,
  sampleRestConfig,
} from '../lib/connectors/rest-client.ts'

const base = Object.fromEntries(Object.entries(REST_DEFAULTS).map(([k, v]) => [k, String(v)]))

async function run() {
  const config = {
    ...base,
    baseUrl: 'https://jsonplaceholder.typicode.com',
    resourcePath: '/users',
    authMethod: 'none',
    paramsKv: JSON.stringify([{ key: '_limit', value: '3', enabled: true }]),
  }

  console.log('REST JSON:', await testRestConfig(config))
  console.log('preview:', (await testRestConfig(config)).preview?.response.status)
  const scan = await scanRestConfig(config)
  console.log('scan:', scan.tables[0].name, scan.tables[0].columns.map((c) => c.name).join(', '))
  const sample = await sampleRestConfig(config, 'users', 2)
  console.log('sample rows:', sample.rows.length)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
