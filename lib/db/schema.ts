import { pgTable, text, boolean, timestamp, integer, jsonb, numeric, index, uniqueIndex } from 'drizzle-orm/pg-core'

// Better Auth tables (required)
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  refreshToken: text('refreshToken'),
  accessToken: text('accessToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  idToken: text('idToken'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

// Layer 1: Data Source Manager
export const dataSources = pgTable('data_sources', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  sourceType: text('sourceType').notNull(),
  config: jsonb('config').notNull(),
  credentials: jsonb('credentials').notNull(),
  status: text('status').default('disconnected'),
  lastConnected: timestamp('lastConnected'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 2: Connector Marketplace — per-user purchased/installed plugins
export const connectorInstalls = pgTable('connector_installs', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  connectorSlug: text('connectorSlug').notNull(),
  purchased: boolean('purchased').notNull().default(false),
  installedAt: timestamp('installedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const connectors = pgTable('connectors', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  icon: text('icon'),
  version: text('version'),
  available: boolean('available').default(true),
  config: jsonb('config'),
  documentation: text('documentation'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 3: Pipeline Designer
export const pipelines = pgTable('pipelines', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('draft'),
  sourceId: text('sourceId'),
  destinationId: text('destinationId'),
  config: jsonb('config').notNull(),
  schedule: jsonb('schedule'),
  enabled: boolean('enabled').default(false),
  version: integer('version').default(1),
  lastRunAt: timestamp('lastRunAt'),
  lastRunStatus: text('lastRunStatus'),
  /** Next scheduled run (UTC); null when manual or disabled. Indexed for the scheduler tick. */
  nextRunAt: timestamp('nextRunAt'),
  /** Runtime state, e.g. { watermark: { column, value } } for incremental sync. Not versioned. */
  state: jsonb('state'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [index('pipelines_next_run_idx').on(t.nextRunAt)])

// Pipeline Steps
export const pipelineSteps = pgTable('pipeline_steps', {
  id: text('id').primaryKey(),
  pipelineId: text('pipelineId').notNull(),
  userId: text('userId').notNull(),
  stepName: text('stepName').notNull(),
  stepType: text('stepType').notNull(),
  stepOrder: integer('stepOrder').notNull(),
  config: jsonb('config'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 4: Scheduler & Layer 5: Monitoring
export const executionLogs = pgTable('execution_logs', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  pipelineId: text('pipelineId').notNull(),
  /** running | success | partial | failed */
  status: text('status').notNull(),
  /** manual | schedule */
  trigger: text('trigger'),
  pipelineVersion: integer('pipelineVersion'),
  recordsProcessed: integer('recordsProcessed').default(0),
  recordsSuccess: integer('recordsSuccess').default(0),
  recordsError: integer('recordsError').default(0),
  errorMessage: text('errorMessage'),
  startTime: timestamp('startTime'),
  endTime: timestamp('endTime'),
  duration: integer('duration'),
  executionDetails: jsonb('executionDetails'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [index('execution_logs_pipeline_idx').on(t.pipelineId, t.createdAt)])

// Rows rejected by a run's Validate step (capped per run) so users can inspect them.
export const pipelineRunRejects = pgTable('pipeline_run_rejects', {
  id: text('id').primaryKey(),
  runId: text('runId').notNull(),
  pipelineId: text('pipelineId').notNull(),
  userId: text('userId').notNull(),
  row: jsonb('row').notNull(),
  errors: jsonb('errors').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (t) => [index('pipeline_run_rejects_run_idx').on(t.runId)])

// In-app alerts (bell icon); email delivery status is tracked per row.
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** error | warning | info */
  level: text('level').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  pipelineId: text('pipelineId'),
  runId: text('runId'),
  /** sent | skipped | failed | null (no email requested) */
  emailStatus: text('emailStatus'),
  readAt: timestamp('readAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)])

// Nexus-managed datasets: pipeline outputs stored as physical tables in the nexus_data schema.
export const nexusDatasets = pgTable('nexus_datasets', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  /** Physical table name inside the nexus_data schema. */
  tableName: text('tableName').notNull().unique(),
  /** [{ name, type }] */
  columns: jsonb('columns').notNull(),
  pipelineId: text('pipelineId'),
  rowCount: integer('rowCount').default(0),
  lastLoadedAt: timestamp('lastLoadedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
}, (t) => [uniqueIndex('nexus_datasets_user_name_idx').on(t.userId, t.name)])

// Layer 6: Data Mapping Studio
export const dataMappings = pgTable('data_mappings', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  pipelineId: text('pipelineId').notNull(),
  sourceField: text('sourceField').notNull(),
  destinationField: text('destinationField').notNull(),
  transformationType: text('transformationType'),
  transformationConfig: jsonb('transformationConfig'),
  active: boolean('active').default(true),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 7: Data Catalog
export const dataCatalog = pgTable('data_catalog', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  dataType: text('dataType'),
  source: text('source'),
  owner: text('owner'),
  classification: text('classification'),
  tags: text('tags').array(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 8: Business Rules Engine
export const businessRules = pgTable('business_rules', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  ruleType: text('ruleType').notNull(),
  condition: jsonb('condition').notNull(),
  action: jsonb('action').notNull(),
  active: boolean('active').default(true),
  appliedTo: text('appliedTo').array(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 9: Data Quality
export const dataQualityMetrics = pgTable('data_quality_metrics', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  dataSourceId: text('dataSourceId'),
  metricName: text('metricName').notNull(),
  metricType: text('metricType').notNull(),
  value: numeric('value'),
  threshold: numeric('threshold'),
  status: text('status'),
  details: jsonb('details'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 10: Analytics & Dashboards
export const dashboards = pgTable('dashboards', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  layout: jsonb('layout').notNull(),
  widgets: jsonb('widgets'),
  refreshInterval: integer('refreshInterval').default(300),
  public: boolean('public').default(false),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 11: Version Control
export const pipelineVersions = pgTable('pipeline_versions', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  pipelineId: text('pipelineId').notNull(),
  version: integer('version').notNull(),
  config: jsonb('config').notNull(),
  changes: text('changes'),
  createdBy: text('createdBy'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

// Layer 12: Governance & Compliance
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  resourceId: text('resourceId'),
  changes: jsonb('changes'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const governancePolicies = pgTable('governance_policies', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  policyType: text('policyType').notNull(),
  rules: jsonb('rules').notNull(),
  active: boolean('active').default(true),
  appliedTo: text('appliedTo').array(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

// Layer 13-14: AI & Advanced Integration
export const integrationConfigs = pgTable('integration_configs', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  integrationName: text('integrationName').notNull(),
  config: jsonb('config').notNull(),
  active: boolean('active').default(false),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})
