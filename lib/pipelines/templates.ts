import { autoMapName, suggestCanonicalField, DOMAIN_BY_NAME } from '@/lib/domain/model'
import { newStepId, type ColumnType, type MapStep, type PipelineEdge, type PipelineNode, type Transform, type ValidationRuleSpec } from './definition'

/**
 * Mapping templates (MP-10) and pipeline templates (PD-8). Client-safe and
 * pure: they turn a source's columns into Map fields, validation rules and a
 * ready-to-edit pipeline graph.
 */

export type Column = { name: string; type: string }
export type MapField = MapStep['fields'][number]

/** Maps scan SQL types (VARCHAR, INTEGER, TIMESTAMP WITH TIME ZONE …) to pipeline column types. */
export function columnTypeFromSql(sqlType: string): ColumnType {
  const t = sqlType.toUpperCase()
  if (/^(INT|INTEGER|BIGINT|SMALLINT|TINYINT|INT2|INT4|INT8|SERIAL|BIGSERIAL)\b/.test(t)) return 'integer'
  if (/(NUMERIC|DECIMAL|DOUBLE|REAL|FLOAT|NUMBER|MONEY)/.test(t)) return 'numeric'
  if (/^(BOOL|BOOLEAN|BIT)\b/.test(t)) return 'boolean'
  if (/TIMESTAMP|DATETIME/.test(t)) return 'timestamp'
  if (/^DATE\b/.test(t)) return 'date'
  if (/JSON/.test(t)) return 'json'
  return 'text'
}

export const newValidationRule = (field = ''): ValidationRuleSpec => ({ field, rule: 'required', value: '', severity: 'error', otherField: '', operator: 'greater_or_equal', ruleId: '' })

/** Every column mapped by name: HR synonyms to canonical names, else snake_case (MP-2). */
export function autoMapFields(columns: Column[], skip = new Set<string>()): MapField[] {
  const used = new Set<string>()
  return columns
    .filter((c) => !skip.has(c.name))
    .map((c) => {
      let to = autoMapName(c.name)
      if (used.has(to)) to = c.name.replace(/[^A-Za-z0-9_]/g, '_').toLowerCase()
      used.add(to)
      return { from: c.name, to, type: columnTypeFromSql(c.type), transforms: [] }
    })
}

/** Columns mapped to one Unified Data Model entity's fields (only recognized ones), typed like the entity. */
export function mapToEntity(columns: Column[], entityName: string): MapField[] {
  const entity = DOMAIN_BY_NAME.get(entityName)
  if (!entity) return []
  const taken = new Set<string>()
  const fields: MapField[] = []
  for (const c of columns) {
    const canonical = suggestCanonicalField(c.name, entity)
    if (!canonical || taken.has(canonical)) continue
    taken.add(canonical)
    const type = entity.fields.find((f) => f.name === canonical)!.type
    fields.push({ from: c.name, to: canonical, type: type === 'json' ? 'json' : type, transforms: type === 'text' ? [{ fn: 'trim', args: [] }] : [] })
  }
  return fields
}

/** HR rule pack (DQ-5) from recognized column names. */
export function hrRulePack(columns: Column[], datasets: { name: string; columns: Column[] }[]): { rules: ValidationRuleSpec[]; notes: string[] } {
  const byCanonical = new Map<string, string>()
  for (const c of columns) {
    const canonical = suggestCanonicalField(c.name)
    if (canonical && !byCanonical.has(canonical)) byCanonical.set(canonical, c.name)
  }
  const col = (n: string) => byCanonical.get(n)
  const rules: ValidationRuleSpec[] = []
  const notes: string[] = []
  const add = (field: string | undefined, patch: Partial<ValidationRuleSpec>) => field && rules.push({ ...newValidationRule(field), ...patch })
  const code = col('employee_code')
  for (const f of ['employee_code', 'full_name', 'email', 'org_code', 'hire_date']) add(col(f), { rule: 'required' })
  add(code, { rule: 'unique' })
  add(col('email'), { rule: 'email' })
  add(col('phone'), { rule: 'phone', severity: 'warning' })
  add(col('national_id'), { rule: 'nik', severity: 'warning' })
  for (const f of ['hire_date', 'birth_date']) {
    add(col(f), { rule: 'date' })
    add(col(f), { rule: 'not_future', severity: 'warning' })
  }
  if (col('termination_date') && col('hire_date')) add(col('termination_date'), { rule: 'compare', otherField: col('hire_date')!, operator: 'greater_or_equal' })
  const lookup = (target: 'org_code' | 'position_code', hint: RegExp) => {
    const ds = datasets.find((d) => hint.test(d.name) && d.columns.some((c) => c.name === target))
    if (ds) add(col(target), { rule: 'exists_in', value: `${ds.name}.${target}` })
    else if (col(target)) notes.push(`No dataset with ${target} yet; add an "exists in dataset" rule once one exists.`)
  }
  lookup('org_code', /org/)
  lookup('position_code', /position|jabatan/)
  if (code && col('manager_code')) add(col('manager_code'), { rule: 'manager', value: code, severity: 'warning' })
  if (!code) notes.push('No employee code column recognized: map one (e.g. PERNR → employee_code) first.')
  return { rules, notes }
}

// ── Mapping templates ────────────────────────────────────────────────────────

export interface MappingTemplate {
  id: string
  name: string
  description: string
  fields: MapField[]
  keepUnmapped: boolean
  builtIn?: boolean
}

const t = (fn: Transform['fn'], ...args: string[]): Transform => ({ fn, args })
const f = (from: string, to: string, type: ColumnType, ...transforms: Transform[]): MapField => ({ from, to, type, transforms })

export const BUILTIN_MAPPING_TEMPLATES: MappingTemplate[] = [
  {
    id: 'builtin:sap-hcm-employee',
    name: 'SAP HCM (PA0001 / PA0002) → Employee',
    description: 'Infotype fields to the Employee entity: PERNR, ENAME, BEGDA/ENDDA (yyyyMMdd), ORGEH, PLANS, BUKRS, WERKS, PERSG, STAT2.',
    keepUnmapped: false,
    builtIn: true,
    fields: [
      f('PERNR', 'employee_code', 'text', t('trim')),
      f('ENAME', 'full_name', 'text', t('trim'), t('titlecase')),
      f('CNAME', 'full_name', 'text', t('trim'), t('titlecase')),
      f('USRID_LONG', 'email', 'text', t('trim'), t('lowercase')),
      f('BEGDA', 'hire_date', 'date', t('format_date', 'yyyy-MM-dd', 'yyyyMMdd')),
      f('ENDDA', 'termination_date', 'date', t('conditional', 'equals', '99991231', '', '{value}'), t('format_date', 'yyyy-MM-dd', 'yyyyMMdd')),
      f('GBDAT', 'birth_date', 'date', t('format_date', 'yyyy-MM-dd', 'yyyyMMdd')),
      f('GESCH', 'gender', 'text', t('conditional', 'equals', '1', 'Male', 'Female')),
      f('ORGEH', 'org_code', 'text', t('trim')),
      f('PLANS', 'position_code', 'text', t('trim')),
      f('BUKRS', 'company_code', 'text', t('trim')),
      f('WERKS', 'work_location', 'text', t('trim')),
      f('PERSG', 'employment_type', 'text', t('trim')),
      f('STAT2', 'employment_status', 'text', t('conditional', 'equals', '3', 'Active', 'Inactive')),
    ],
  },
  {
    id: 'builtin:talenta-employee',
    name: 'Talenta (Mekari) employee → Employee',
    description: 'Talenta API fields (personal.*, employment.*) to the Employee entity.',
    keepUnmapped: false,
    builtIn: true,
    fields: [
      f('employment.employee_id', 'employee_code', 'text', t('trim')),
      f('personal.first_name', 'full_name', 'text', t('concat', '{personal.first_name} {personal.last_name}'), t('trim')),
      f('personal.email', 'email', 'text', t('trim'), t('lowercase')),
      f('personal.mobile_phone', 'phone', 'text', t('trim')),
      f('personal.birth_date', 'birth_date', 'date'),
      f('personal.gender', 'gender', 'text'),
      f('employment.join_date', 'hire_date', 'date'),
      f('employment.resign_date', 'termination_date', 'date'),
      f('employment.status', 'employment_status', 'text'),
      f('employment.employment_status', 'employment_type', 'text'),
      f('employment.organization_name', 'department', 'text'),
      f('employment.job_position', 'position_code', 'text'),
      f('employment.branch', 'work_location', 'text'),
    ],
  },
  {
    id: 'builtin:ad-users',
    name: 'Active Directory user → Users',
    description: 'AD/LDAP user attributes: sAMAccountName, employeeID, displayName, mail, department, title, manager (name from the DN), enabled state.',
    keepUnmapped: false,
    builtIn: true,
    fields: [
      f('sAMAccountName', 'username', 'text', t('trim'), t('lowercase')),
      f('employeeID', 'employee_code', 'text', t('trim')),
      f('displayName', 'full_name', 'text', t('trim')),
      f('mail', 'email', 'text', t('trim'), t('lowercase')),
      f('department', 'department', 'text'),
      f('title', 'job_title', 'text'),
      f('telephoneNumber', 'phone', 'text', t('trim')),
      f('mobile', 'mobile', 'text', t('trim')),
      f('manager', 'manager_name', 'text', t('regex_extract', '^CN=([^,]+)', '1')),
      f('userAccountControl', 'account_status', 'text', t('conditional', 'in_list', '514,546,66050,66082', 'Disabled', 'Enabled')),
      f('dn', 'distinguished_name', 'text'),
    ],
  },
]

/** Template fields whose source column exists here (case-insensitive), renamed to the real column; reports what's missing. */
export function applyMappingTemplate(template: MappingTemplate, columns: Column[]): { fields: MapField[]; missing: string[] } {
  const byLower = new Map(columns.map((c) => [c.name.toLowerCase(), c.name]))
  const fields: MapField[] = []
  const missing: string[] = []
  const targets = new Set<string>()
  for (const field of template.fields) {
    const from = byLower.get(field.from.toLowerCase())
    if (!from || targets.has(field.to)) {
      if (!from) missing.push(field.from)
      continue
    }
    targets.add(field.to)
    fields.push({ ...field, from })
  }
  return { fields, missing }
}

// ── Pipeline templates (PD-8) ────────────────────────────────────────────────

export const PIPELINE_TEMPLATES = [
  { id: 'hris-employee', name: 'HRIS → Employee', description: 'Read employees from SAP, Talenta or any HR table, map them to the Employee entity, check them with the HR rule pack, and keep an up-to-date employees dataset (upsert, departures marked deleted).', sourceHint: 'Any source with an employee table', defaultDataset: 'employees' },
  { id: 'ad-users', name: 'Active Directory → Users', description: 'Copy AD/LDAP users into an ad_users dataset with usernames, emails, departments, managers and whether the account is enabled.', sourceHint: 'An Active Directory / LDAP source (users)', defaultDataset: 'ad_users' },
  { id: 'csv-dataset', name: 'CSV / Excel → Dataset', description: 'Turn an uploaded file into a dataset with clean column names and the detected types; each run replaces it with the latest upload. Good for lookup tables.', sourceHint: 'A File Upload source', defaultDataset: '' },
] as const
export type PipelineTemplateId = (typeof PIPELINE_TEMPLATES)[number]['id']

const datasetSafe = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([^a-z])/, 't_$1').slice(0, 48) || 'dataset'

export function buildPipelineTemplate(
  id: PipelineTemplateId,
  opts: { dataSourceId: string; sourceType: string; table: string; columns: Column[]; datasetName?: string; datasets: { name: string; columns: Column[] }[] }
): { name: string; description: string; nodes: PipelineNode[]; edges: PipelineEdge[]; notes: string[] } {
  const notes: string[] = []
  const at = (i: number) => ({ x: 40 + i * 300, y: 120 })
  const source: PipelineNode = { id: newStepId(), type: 'source', position: at(0), dataSourceId: opts.dataSourceId, table: opts.table, maxRows: 1_000_000, mode: 'full', watermarkColumn: '' }
  const chain = (nodes: PipelineNode[]) => ({ nodes, edges: nodes.slice(1).map((n, i) => ({ id: newStepId(), from: nodes[i].id, to: n.id, branch: '' })) })
  const template = (tid: string) => BUILTIN_MAPPING_TEMPLATES.find((x) => x.id === tid)!

  if (id === 'csv-dataset') {
    const map: PipelineNode = { id: newStepId(), type: 'map', position: at(1), keepUnmapped: false, fields: opts.columns.map((c) => ({ from: c.name, to: datasetSafe(c.name), type: columnTypeFromSql(c.type), transforms: [] })) }
    const datasetName = datasetSafe(opts.datasetName || opts.table)
    const dest: PipelineNode = { id: newStepId(), type: 'destination', position: at(2), kind: 'dataset', datasetName, mode: 'replace', keys: [], softDeleteMissing: false }
    return { name: `${opts.table} → ${datasetName}`, description: 'Uploaded file to dataset (template CSV / Excel → Dataset)', ...chain([source, map, dest]), notes }
  }

  if (id === 'ad-users') {
    const { fields, missing } = applyMappingTemplate(template('builtin:ad-users'), opts.columns)
    if (missing.length) notes.push(`Not in this table, skipped: ${missing.join(', ')}`)
    const map: PipelineNode = { id: newStepId(), type: 'map', position: at(1), keepUnmapped: false, fields: fields.length ? fields : autoMapFields(opts.columns) }
    const hasUser = fields.some((x) => x.to === 'username')
    const validate: PipelineNode = { id: newStepId(), type: 'validate', position: at(2), onFail: 'reject', rules: [...(hasUser ? [{ ...newValidationRule('username') }, { ...newValidationRule('username'), rule: 'unique' as const }] : []), ...(fields.some((x) => x.to === 'email') ? [{ ...newValidationRule('email'), rule: 'email' as const, severity: 'warning' as const }] : [])] }
    const datasetName = datasetSafe(opts.datasetName || 'ad_users')
    const dest: PipelineNode = { id: newStepId(), type: 'destination', position: at(3), kind: 'dataset', datasetName, mode: hasUser ? 'upsert' : 'replace', keys: hasUser ? ['username'] : [], softDeleteMissing: hasUser }
    const nodes = validate.type === 'validate' && validate.rules.length ? [source, map, validate, dest] : [source, map, { ...dest, position: at(2) }]
    if (!hasUser) notes.push('No sAMAccountName column: the dataset is replaced on each run instead of updated by username.')
    return { name: 'Active Directory users', description: 'AD users to a dataset (template Active Directory → Users)', ...chain(nodes), notes }
  }

  // HRIS → Employee: a vendor template when the source is known, else synonyms.
  const vendor = opts.sourceType === 'sap' ? template('builtin:sap-hcm-employee') : opts.sourceType === 'talenta' ? template('builtin:talenta-employee') : null
  let fields: MapField[] = []
  if (vendor) {
    const applied = applyMappingTemplate(vendor, opts.columns)
    fields = applied.fields
    notes.push(`Mapped with the ${vendor.name} template.`)
  }
  const mappedFrom = new Set(fields.map((x) => x.from))
  const mappedTo = new Set(fields.map((x) => x.to))
  for (const x of mapToEntity(opts.columns.filter((c) => !mappedFrom.has(c.name)), 'employee')) if (!mappedTo.has(x.to)) (fields.push(x), mappedTo.add(x.to))
  if (!fields.length) {
    fields = autoMapFields(opts.columns)
    notes.push('No employee columns recognized; every column is mapped by name. Rename targets to employee_code, full_name, email … to use the HR checks.')
  }
  const map: PipelineNode = { id: newStepId(), type: 'map', position: at(1), keepUnmapped: false, fields }
  const mappedColumns = fields.map((x) => ({ name: x.to, type: x.type }))
  const pack = hrRulePack(mappedColumns, opts.datasets)
  notes.push(...pack.notes)
  const hasCode = mappedTo.has('employee_code')
  const validate: PipelineNode = { id: newStepId(), type: 'validate', position: at(2), onFail: 'reject', rules: pack.rules }
  const datasetName = datasetSafe(opts.datasetName || 'employees')
  const dest: PipelineNode = { id: newStepId(), type: 'destination', position: at(3), kind: 'dataset', datasetName, mode: hasCode ? 'upsert' : 'replace', keys: hasCode ? ['employee_code'] : [], softDeleteMissing: hasCode }
  const nodes = pack.rules.length ? [source, map, validate, dest] : [source, map, { ...dest, position: at(2) }]
  return { name: 'Employee sync', description: `${opts.table} to the Employee entity (template HRIS → Employee)`, ...chain(nodes), notes }
}
