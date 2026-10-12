import type { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, RootOperationNode, UnknownRow } from 'kysely'
import { openSsoConfigJson } from '@/lib/security/credentials'

/**
 * Opens sealed SSO secrets (TD-25) in rows Better Auth reads, so the SSO plugin
 * gets the plain `oidcConfig` / `samlConfig` it expects while the database only
 * holds them encrypted. Only rows that carry a `providerId` (ssoProvider) and a
 * sealed config are touched; every other query passes through unchanged.
 * Writes are not transformed: the plugin's provider-management endpoints are
 * disabled and app/actions/sso.ts seals what it writes.
 */
export class SsoConfigPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    const { result } = args
    if (!result.rows?.length || !result.rows.some(isSealedProviderRow)) return result
    return {
      ...result,
      rows: result.rows.map((row) => {
        if (!isSealedProviderRow(row)) return row
        const providerId = String(row.providerId)
        const open = (v: unknown) => {
          if (typeof v !== 'string') return v
          try {
            return openSsoConfigJson(providerId, v)
          } catch (err) {
            // Never log the config; a provider that can't be opened fails its sign-in instead.
            console.error(`[auth] SSO provider ${providerId}: sealed secret could not be opened:`, err instanceof Error ? err.message : 'failed')
            return null
          }
        }
        return { ...row, oidcConfig: open(row.oidcConfig), samlConfig: open(row.samlConfig) }
      }),
    }
  }
}

function isSealedProviderRow(row: UnknownRow): boolean {
  if (typeof row.providerId !== 'string') return false
  return [row.oidcConfig, row.samlConfig].some((v) => typeof v === 'string' && v.includes('"__sealed"'))
}
