import { z } from 'zod'

/**
 * Dataset policies (PRD Layer 13, GV-5 / GV-10). Client-safe: the Governance
 * screen and the server share these. Masking itself runs server-side
 * (lib/governance/masking.ts).
 */

export const CLASSIFICATIONS = ['public', 'internal', 'personal', 'sensitive'] as const
export type Classification = (typeof CLASSIFICATIONS)[number]

export const MASKS = ['none', 'full', 'partial', 'hash'] as const
export type Mask = (typeof MASKS)[number]

export const CLASSIFICATION_INFO: Record<Classification, { label: string; description: string }> = {
  public: { label: 'Public', description: 'No restriction' },
  internal: { label: 'Internal', description: 'Company data, not personal' },
  personal: { label: 'Personal (PII)', description: 'Identifies a person: name, email, phone, ID numbers' },
  sensitive: { label: 'Sensitive', description: 'Salary, bank, health, religion and other special categories (UU PDP)' },
}

export const MASK_INFO: Record<Mask, { label: string; example: string }> = {
  none: { label: 'No mask', example: 'budi@kmplus.co.id' },
  full: { label: 'Hide', example: '••••••' },
  partial: { label: 'Keep last 4', example: '••••o.id' },
  hash: { label: 'Pseudonymize', example: 'a3f9c2e81b07' },
}

export const columnPolicySchema = z.object({
  classification: z.enum(CLASSIFICATIONS).default('public'),
  mask: z.enum(MASKS).default('none'),
})
export type ColumnPolicy = z.infer<typeof columnPolicySchema>

export const policyInputSchema = z.object({
  datasetName: z.string().trim().min(1).max(63),
  columns: z.record(z.string().max(128), columnPolicySchema).refine((c) => Object.keys(c).length <= 500, 'Too many columns'),
  /** Keep rows loaded in the last N days (1 day … 10 years); null keeps everything. */
  retentionDays: z.number().int().min(1).max(3650).nullable(),
})
export type PolicyInput = z.infer<typeof policyInputSchema>

const SENSITIVE = /salary|gaji|wage|bonus|bank|rekening|account_?no|iban|health|medical|diagnos|religion|agama|ethnic|suku|blood|disab|biometric|password|secret/i
const PERSONAL = /e-?mail|phone|mobile|hp\b|telp|whatsapp|nik\b|ktp|npwp|passport|paspor|national_?id|ssn|birth|lahir|dob\b|address|alamat|full_?name|first_?name|last_?name|^name$|nama|ip_?address/i

/** A starting classification and mask from the column name; users review and save it. */
export function suggestColumnPolicy(column: string): ColumnPolicy {
  if (SENSITIVE.test(column)) return { classification: 'sensitive', mask: 'full' }
  if (PERSONAL.test(column)) return { classification: 'personal', mask: /e-?mail|phone|mobile|hp\b|telp|whatsapp/i.test(column) ? 'partial' : 'hash' }
  return { classification: 'public', mask: 'none' }
}

/** Columns a policy masks (mask other than none). */
export function maskedColumns(columns: Record<string, ColumnPolicy> | null | undefined): string[] {
  return Object.entries(columns ?? {})
    .filter(([, p]) => p.mask !== 'none')
    .map(([name]) => name)
}
