/**
 * Secrets managers (Vault, AWS Secrets Manager, Azure Key Vault, Google Secret
 * Manager, Doppler) supply credential values to other data sources through
 * references; they are never read as data. Client-safe.
 */

/** A secret: a single string, or named fields (Vault KV, JSON secrets). */
export type SecretValue = string | Record<string, string>

export const SECRET_MANAGER_SLUGS = ['vault', 'awssecrets', 'azurekeyvault', 'gcpsecrets', 'doppler'] as const
export type SecretManagerSlug = (typeof SECRET_MANAGER_SLUGS)[number]

export const isSecretManager = (slug: string | null | undefined): slug is SecretManagerSlug => !!slug && (SECRET_MANAGER_SLUGS as readonly string[]).includes(slug)

/**
 * A reference inside any credential value: {{secret:<data source name>:<path>}} or
 * {{secret:<data source name>:<path>#<field>}}. It can be the whole value or part
 * of one, e.g. postgres://nexus:{{secret:Vault:hr/db#password}}@db.corp:5432/hr.
 */
export const SECRET_REF = /\{\{\s*secret:([^:{}]+?)\s*:\s*([^#{}]+?)\s*(?:#\s*([^{}]+?)\s*)?\}\}/g

export interface SecretRef {
  raw: string
  source: string
  path: string
  field?: string
}

export function findSecretRefs(value: string): SecretRef[] {
  return [...value.matchAll(SECRET_REF)].map((m) => ({ raw: m[0], source: m[1].trim(), path: m[2].trim(), field: m[3]?.trim() || undefined }))
}

export const hasSecretRefs = (values: Record<string, unknown>) => Object.values(values).some((v) => typeof v === 'string' && findSecretRefs(v).length > 0)

export function secretRef(source: string, path: string, field?: string) {
  return `{{secret:${source}:${path}${field ? `#${field}` : ''}}}`
}

/** A reference that can't be resolved: retrying won't help. */
export class SecretRefError extends Error {
  readonly retryable = false
}

/** Picks the field of a secret: #field, the only field, or the whole string. */
export function secretField(value: SecretValue, field: string | undefined, label: string): string {
  if (typeof value === 'string') {
    if (!field) return value
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && field in parsed) return String(parsed[field])
    } catch {
      /* not JSON */
    }
    throw new SecretRefError(`Secret ${label} has no field "${field}".`)
  }
  if (field) {
    if (!(field in value)) throw new SecretRefError(`Secret ${label} has no field "${field}". Fields: ${Object.keys(value).join(', ') || 'none'}.`)
    return value[field]
  }
  const keys = Object.keys(value)
  if (keys.length === 1) return value[keys[0]]
  throw new SecretRefError(`Secret ${label} has several fields (${keys.join(', ')}); add #field to the reference.`)
}

