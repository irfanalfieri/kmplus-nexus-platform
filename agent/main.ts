import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AGENT_VERSION, checkConfig, parseConfig, runAgent } from './nexus-agent'

/**
 * Command line for the Nexus Agent.
 *
 *   node nexus-agent.mjs [--config nexus-agent.json] [--check]
 *
 * --check tests the connections (and AI model) in the config, then exits.
 */
async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--version')) return console.log(AGENT_VERSION)
  const configIndex = args.indexOf('--config')
  const path = resolve(configIndex >= 0 ? args[configIndex + 1] : process.env.NEXUS_AGENT_CONFIG ?? 'nexus-agent.json')
  let config
  try {
    config = parseConfig(JSON.parse(readFileSync(path, 'utf8')))
  } catch (err) {
    console.error(`Config ${path}: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
  console.log(`KMPlus Nexus Agent ${AGENT_VERSION} (Node ${process.version})`)
  if (args.includes('--check')) process.exit((await checkConfig(config)) ? 0 : 1)

  const stop = new AbortController()
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log('Stopping after running tasks finish…')
      stop.abort()
    })
  }
  try {
    await runAgent(config, { signal: stop.signal })
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

void main()
