import { sql } from 'drizzle-orm'
import { pgTable, text, boolean, timestamp, integer, jsonb, numeric, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core'

// Better Auth tables (required)
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  /** Better Auth two-factor plugin. Nexus requires TOTP 2FA for every account. */
  twoFactorEnabled: boolean('twoFactorEnabled').default(false),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  /** "sso" when the session came from a workspace identity provider (MFA is the IdP's job); null for password sign-ins. */
  authMethod: text('authMethod'),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

// Better Auth SSO plugin (@better-auth/sso). Rows are written by app/actions/sso.ts, not the plugin's public endpoints.
export const ssoProvider = pgTable('ssoProvider', {
  id: text('id').primaryKey(),
  issuer: text('issuer').notNull(),
  /** JSON (OIDCConfig) as the plugin expects it. */
  oidcConfig: text('oidcConfig'),
  samlConfig: text('samlConfig'),
  userId: text('userId'),
  providerId: text('providerId').notNull().unique(),
  organizationId: text('organizationId'),
  domain: text('domain').notNull(),
  domainVerified: boolean('domainVerified').default(false),
})

/** Which workspace an SSO provider signs users into, with what role, and its DNS verification. */
export const workspaceSso = pgTable('workspace_sso', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  providerId: text('providerId').notNull().unique(),
  label: text('label').notNull(),
  /** azure | google | okta | oidc */
  preset: text('preset').notNull(),
  domain: text('domain').notNull(),
  defaultRole: text('defaultRole').notNull().default('viewer'),
  /** Block password sign-in for emails at this domain. */
  enforce: boolean('enforce').notNull().default(false),
  /** oidc | saml */
  protocol: text('protocol').notNull().default('oidc'),
  /** Add users to the workspace on their first SSO sign-in. Off = only SCIM-provisioned users get access. */
  jitProvisioning: boolean('jitProvisioning').notNull().default(true),
  verificationToken: text('verificationToken').notNull(),
  verifiedAt: timestamp('verifiedAt', { withTimezone: true }),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('workspace_sso_workspace_idx').on(t.workspaceId)])

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  refreshToken: text('refreshToken'),
  accessToken: text('accessToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
  scope: text('scope'),
  idToken: text('idToken'),
  password: text('password'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

// Better Auth two-factor plugin: TOTP secret and backup codes (both encrypted by Better Auth).
export const twoFactor = pgTable('twoFactor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backupCodes').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  verified: boolean('verified').default(true),
  failedVerificationCount: integer('failedVerificationCount').default(0),
  lockedUntil: timestamp('lockedUntil', { withTimezone: true }),
}, (t) => [index('twoFactor_userId_idx').on(t.userId), index('twoFactor_secret_idx').on(t.secret)])

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow(),
})

// Workspaces (tenants). Everything a team shares belongs to one workspace.
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('createdBy').notNull(),
  /** Who must approve a pipeline publish (GV-6): off | destructive (replace / mark-deleted writes) | always. */
  publishApproval: text('publishApproval').notNull().default('off'),
  /** Stage in an environment group (GV-7): dev | staging | prod; null = not part of a group. */
  environment: text('environment'),
  /** Workspaces promoting into each other share this id (GV-7). */
  environmentGroupId: text('environmentGroupId'),
  /** Pipelines here change only through promotion from the previous stage. */
  environmentLocked: boolean('environmentLocked').notNull().default(false),
  /** AI assistant (#14): off | server (the open-source model configured by NEXUS_AI_*) | agent (a model next to one of this workspace's agents). */
  aiProvider: text('aiProvider').notNull().default('server'),
  /** The agent whose local model answers when aiProvider = agent. */
  aiAgentId: text('aiAgentId'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: text('workspaceId').notNull(),
  userId: text('userId').notNull(),
  /** admin | steward | operator | analyst | auditor | viewer (lib/auth/permissions.ts) */
  role: text('role').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('workspace_members_user_idx').on(t.userId)])

/** Invite links. Only a SHA-256 hash of the token is stored; the link is shown once. */
export const workspaceInvites = pgTable('workspace_invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  tokenHash: text('tokenHash').notNull().unique(),
  invitedBy: text('invitedBy').notNull(),
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('acceptedAt', { withTimezone: true }),
  acceptedBy: text('acceptedBy'),
  revokedAt: timestamp('revokedAt', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('workspace_invites_workspace_idx').on(t.workspaceId)])

// Layer 1: Data Source Manager
export const dataSources = pgTable('data_sources', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** Owning workspace; every query is scoped by this. userId = who created / acted. */
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  sourceType: text('sourceType').notNull(),
  config: jsonb('config').notNull(),
  credentials: jsonb('credentials').notNull(),
  status: text('status').default('disconnected'),
  lastConnected: timestamp('lastConnected', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('data_sources_workspace_idx').on(t.workspaceId)])

// Layer 2: Connector Marketplace — per-user purchased/installed plugins
export const connectorInstalls = pgTable('connector_installs', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** Owning workspace; every query is scoped by this. userId = who created / acted. */
  workspaceId: text('workspaceId').notNull(),
  connectorSlug: text('connectorSlug').notNull(),
  purchased: boolean('purchased').notNull().default(false),
  installedAt: timestamp('installedAt', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('connector_installs_workspace_slug_idx').on(t.workspaceId, t.connectorSlug)])

// Layer 3: Pipeline Designer
export const pipelines = pgTable('pipelines', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** Owning workspace; every query is scoped by this. userId = who created / acted. */
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('draft'),
  sourceId: text('sourceId'),
  destinationId: text('destinationId'),
  /** The published definition: what scheduled and manual runs execute (VC-2). */
  config: jsonb('config').notNull(),
  schedule: jsonb('schedule'),
  enabled: boolean('enabled').default(false),
  /** Published version number. */
  version: integer('version').default(1),
  /** Unpublished edits (latest draft version); null when the draft equals the published version. */
  draftConfig: jsonb('draftConfig'),
  draftVersion: integer('draftVersion'),
  lastRunAt: timestamp('lastRunAt', { withTimezone: true }),
  lastRunStatus: text('lastRunStatus'),
  /** Next scheduled run (UTC); null when manual or disabled. Indexed for the scheduler tick. */
  nextRunAt: timestamp('nextRunAt', { withTimezone: true }),
  /** Runtime state, e.g. { watermark: { column, value } } for incremental sync. Not versioned. */
  state: jsonb('state'),
  /** SHA-256 of the inbound webhook trigger token (SC-1); null = webhook trigger off. */
  triggerTokenHash: text('triggerTokenHash'),
  /** Same value in every environment a pipeline was promoted through (the id it had where it was created, GV-7). */
  promotionKey: text('promotionKey'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('pipelines_next_run_idx').on(t.nextRunAt), index('pipelines_workspace_idx').on(t.workspaceId), index('pipelines_promotion_idx').on(t.workspaceId, t.promotionKey)])

/** A pipeline version waiting for a second person before it runs (GV-6). */
export const pipelineApprovals = pgTable('pipeline_approvals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  pipelineId: text('pipelineId').notNull(),
  /** The pipeline_versions version that is published on approval. */
  version: integer('version').notNull(),
  /** publish (a change made here) | promote (arrived from the previous environment) */
  kind: text('kind').notNull().default('publish'),
  /** pending | approved | rejected | cancelled | superseded */
  status: text('status').notNull().default('pending'),
  /** Why approval is needed, e.g. "Replaces dataset employees". */
  reasons: jsonb('reasons').notNull().default([]),
  /** Schedule on/off to apply when published (null = keep). */
  enabled: boolean('enabled'),
  requestNote: text('requestNote'),
  requestedBy: text('requestedBy').notNull(),
  /** Promotions: the workspace (environment) it came from. */
  fromWorkspaceId: text('fromWorkspaceId'),
  decidedBy: text('decidedBy'),
  decisionNote: text('decisionNote'),
  decidedAt: timestamp('decidedAt', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('pipeline_approvals_inbox_idx').on(t.workspaceId, t.status, t.createdAt), index('pipeline_approvals_pipeline_idx').on(t.pipelineId)])

// Layer 4: Scheduler & Layer 5: Monitoring
export const executionLogs = pgTable('execution_logs', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** Owning workspace; every query is scoped by this. userId = who created / acted. */
  workspaceId: text('workspaceId').notNull(),
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
  startTime: timestamp('startTime', { withTimezone: true }),
  endTime: timestamp('endTime', { withTimezone: true }),
  duration: integer('duration'),
  executionDetails: jsonb('executionDetails'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('execution_logs_pipeline_idx').on(t.pipelineId, t.createdAt), index('execution_logs_workspace_idx').on(t.workspaceId, t.startTime)])

// Background worker queue (TD-5): one job per pipeline run. The worker claims a
// job with a lease (FOR UPDATE SKIP LOCKED), processes the source in chunks and
// checkpoints "progress" after each chunk, so a run can span many invocations.
export const pipelineJobs = pgTable('pipeline_jobs', {
  /** Same id as the run (execution_logs.id). */
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  pipelineId: text('pipelineId').notNull(),
  /** Who triggered (manual) or owns (schedule) the run. */
  actorId: text('actorId').notNull(),
  trigger: text('trigger').notNull(),
  /** queued | running | done */
  status: text('status').notNull().default('queued'),
  /** Failed attempts so far (transient errors are retried from the last checkpoint). */
  attempts: integer('attempts').notNull().default(0),
  /** Not picked up before this time (retry backoff). */
  availableAt: timestamp('availableAt', { withTimezone: true }).notNull().defaultNow(),
  /** A running job whose lease has expired is considered abandoned and is resumed. */
  leaseUntil: timestamp('leaseUntil', { withTimezone: true }),
  progress: jsonb('progress'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('pipeline_jobs_claim_idx').on(t.status, t.availableAt),
  // At most one queued/running job per pipeline: no overlapping runs.
  uniqueIndex('pipeline_jobs_one_active_idx').on(t.pipelineId).where(sql`${t.status} <> 'done'`),
])

// Values already seen by Validate unique rules in earlier chunks of a running job (hashed).
export const pipelineJobSeen = pgTable('pipeline_job_seen', {
  jobId: text('jobId').notNull(),
  field: text('field').notNull(),
  hash: text('hash').notNull(),
}, (t) => [primaryKey({ columns: [t.jobId, t.field, t.hash] })])

// Rows rejected by a run's Validate step (capped per run) so users can inspect them.
export const pipelineRunRejects = pgTable('pipeline_run_rejects', {
  id: text('id').primaryKey(),
  runId: text('runId').notNull(),
  pipelineId: text('pipelineId').notNull(),
  userId: text('userId').notNull(),
  /** Owning workspace; every query is scoped by this. userId = who created / acted. */
  workspaceId: text('workspaceId').notNull(),
  /** The row as it entered the node that quarantined it. */
  row: jsonb('row').notNull(),
  errors: jsonb('errors').notNull(),
  /** Node that quarantined, flagged or held the row (replays start there). */
  nodeId: text('nodeId'),
  /** error | warning | info */
  severity: text('severity').notNull().default('error'),
  /** invalid (not written) | approval (held for approval) | flag (written with a warning) */
  kind: text('kind').notNull().default('invalid'),
  /** open | fixed | approved | replayed | dismissed */
  status: text('status').notNull().default('open'),
  /** Steward's corrected row (DQ-3 edit inline / bulk-fix). */
  fixedRow: jsonb('fixedRow'),
  updatedBy: text('updatedBy'),
  updatedAt: timestamp('updatedAt', { withTimezone: true }),
  /** Run that replayed this row. */
  replayRunId: text('replayRunId'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('pipeline_run_rejects_run_idx').on(t.runId),
  index('pipeline_run_rejects_inbox_idx').on(t.workspaceId, t.status, t.createdAt),
])

// Manager checks (HR rule pack): (employee, manager) pairs collected during a run, checked at the end.
export const pipelineJobPairs = pgTable('pipeline_job_pairs', {
  jobId: text('jobId').notNull(),
  nodeId: text('nodeId').notNull(),
  field: text('field').notNull(),
  keyField: text('keyField').notNull(),
  key: text('key').notNull(),
  manager: text('manager').notNull(),
}, (t) => [index('pipeline_job_pairs_job_idx').on(t.jobId)])

// Business rules (PRD Layer 11): reusable IF/THEN rules referenced by pipeline nodes.
export const businessRules = pgTable('business_rules', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  /** { when, then, otherwise } — lib/rules/definition.ts */
  body: jsonb('body').notNull(),
  version: integer('version').notNull().default(1),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('business_rules_workspace_idx').on(t.workspaceId)])

// Every save of a rule is an immutable version (VC-1).
export const businessRuleVersions = pgTable('business_rule_versions', {
  id: text('id').primaryKey(),
  ruleId: text('ruleId').notNull(),
  workspaceId: text('workspaceId').notNull(),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  body: jsonb('body').notNull(),
  changes: text('changes'),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('business_rule_versions_rule_idx').on(t.ruleId, t.version)])

// In-app alerts (bell icon); email delivery status is tracked per row.
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** Owning workspace; every query is scoped by this. userId = who created / acted. */
  workspaceId: text('workspaceId').notNull(),
  /** error | warning | info */
  level: text('level').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  pipelineId: text('pipelineId'),
  runId: text('runId'),
  /** sent | skipped | failed | null (no email requested) */
  emailStatus: text('emailStatus'),
  readAt: timestamp('readAt', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.workspaceId, t.createdAt)])

// Nexus-managed datasets: pipeline outputs stored as physical tables in the nexus_data schema.
export const nexusDatasets = pgTable('nexus_datasets', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** Owning workspace; every query is scoped by this. userId = who created / acted. */
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  /** Physical table name inside the nexus_data schema. */
  tableName: text('tableName').notNull().unique(),
  /** [{ name, type }] */
  columns: jsonb('columns').notNull(),
  pipelineId: text('pipelineId'),
  rowCount: integer('rowCount').default(0),
  lastLoadedAt: timestamp('lastLoadedAt', { withTimezone: true }),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('nexus_datasets_workspace_name_idx').on(t.workspaceId, t.name)])

// Governance (PRD Layer 13): per-dataset column classification, masking and retention.
export const datasetPolicies = pgTable('dataset_policies', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  datasetName: text('datasetName').notNull(),
  /** { [column]: { classification: 'public' | 'internal' | 'personal' | 'sensitive', mask: 'none' | 'full' | 'partial' | 'hash' } } */
  columns: jsonb('columns').notNull().default({}),
  /** Keep rows loaded in the last N days; null keeps everything. */
  retentionDays: integer('retentionDays'),
  retentionAppliedAt: timestamp('retentionAppliedAt', { withTimezone: true }),
  /** Row-level access (DB-6): [{ roles, column, operator, value }]; those roles only see matching rows. */
  rowFilters: jsonb('rowFilters').notNull().default([]),
  updatedBy: text('updatedBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('dataset_policies_workspace_dataset_idx').on(t.workspaceId, t.datasetName)])

// Analytics (PRD Layer 10): dashboards of widgets bound to workspace datasets.
export const dashboards = pgTable('dashboards', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  /** Widget specs, validated by lib/analytics/definition.ts. */
  widgets: jsonb('widgets').notNull().default([]),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('dashboards_workspace_idx').on(t.workspaceId)])

// Data Catalog (PRD Layer 8) + Virtualization (Layer 9). Datasets and source
// tables are listed automatically; a row exists once someone documents one.
export const catalogEntries = pgTable('catalog_entries', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  /** "dataset:<name>" or "source:<dataSourceId>:<table>" */
  key: text('key').notNull(),
  /** dataset | source_table */
  kind: text('kind').notNull(),
  datasetName: text('datasetName'),
  dataSourceId: text('dataSourceId'),
  tableName: text('tableName'),
  description: text('description'),
  ownerId: text('ownerId'),
  stewardId: text('stewardId'),
  tags: jsonb('tags').notNull().default([]),
  /** public | internal | confidential | pii */
  classification: text('classification').notNull().default('internal'),
  /** { [column]: business description } */
  columnDocs: jsonb('columnDocs').notNull().default({}),
  /** Source tables (DV-1): live (query the source) or cached (a managed pipeline copies it into dataset `alias`). */
  accessMode: text('accessMode').notNull().default('live'),
  /** Name the table is published under (Data API, Analytics when cached). */
  alias: text('alias'),
  /** manual | 5m | 15m | hourly | daily | after_pipeline (DV-2) */
  refresh: text('refresh').notNull().default('daily'),
  refreshAfterPipelineId: text('refreshAfterPipelineId'),
  /** The managed pipeline that refreshes a cached copy. */
  cachePipelineId: text('cachePipelineId'),
  /** Live query guardrails (DV-3). */
  liveRowLimit: integer('liveRowLimit').notNull().default(1000),
  liveTimeoutSeconds: integer('liveTimeoutSeconds').notNull().default(30),
  updatedBy: text('updatedBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('catalog_entries_workspace_key_idx').on(t.workspaceId, t.key),
  uniqueIndex('catalog_entries_workspace_alias_idx').on(t.workspaceId, t.alias),
])

// Data API keys (API-1). Only a SHA-256 hash of the key is stored; it is shown once.
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  /** First characters of the key, to recognize it in lists. */
  prefix: text('prefix').notNull(),
  hash: text('hash').notNull().unique(),
  /** Role whose masking and row filters apply to reads (analyst = masked, steward = unmasked). */
  role: text('role').notNull().default('analyst'),
  /** ["datasets:read", "domains:read", "pipelines:run", "runs:read"] */
  scopes: jsonb('scopes').notNull().default([]),
  /** Requests per minute (API-6). */
  rateLimitPerMinute: integer('rateLimitPerMinute').notNull().default(120),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('lastUsedAt', { withTimezone: true }),
  expiresAt: timestamp('expiresAt', { withTimezone: true }),
  revokedAt: timestamp('revokedAt', { withTimezone: true }),
  revokedBy: text('revokedBy'),
}, (t) => [index('api_keys_workspace_idx').on(t.workspaceId)])

// Unified Enterprise Data Model (§8, API-3): which dataset publishes an entity, and how its columns map.
export const domainMappings = pgTable('domain_mappings', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  /** employee | organization | position | … (lib/domain/model.ts) */
  entity: text('entity').notNull(),
  datasetName: text('datasetName').notNull(),
  /** { [canonical field]: dataset column } */
  fields: jsonb('fields').notNull().default({}),
  updatedBy: text('updatedBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('domain_mappings_workspace_entity_idx').on(t.workspaceId, t.entity)])

// Layer 11: Version Control
export const pipelineVersions = pgTable('pipeline_versions', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** Owning workspace; every query is scoped by this. userId = who created / acted. */
  workspaceId: text('workspaceId').notNull(),
  pipelineId: text('pipelineId').notNull(),
  version: integer('version').notNull(),
  config: jsonb('config').notNull(),
  changes: text('changes'),
  createdBy: text('createdBy'),
  /** Set when this version was published (it is what runs). Versions are immutable otherwise. */
  publishedAt: timestamp('publishedAt', { withTimezone: true }),
  publishedBy: text('publishedBy'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('pipeline_versions_pipeline_idx').on(t.pipelineId, t.version)])

// Layer 12: Governance & Compliance
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  /** Workspace the event belongs to; null for account-level events (login, 2FA). userId = who acted. */
  workspaceId: text('workspaceId'),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  resourceId: text('resourceId'),
  changes: jsonb('changes'),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
})


// Fixed-window request counters for the Data API and inbound webhooks (API-6).
export const apiRateLimits = pgTable('api_rate_limits', {
  /** "key:<apiKeyId>" or "hook:<pipelineId>" */
  bucket: text('bucket').notNull(),
  windowStart: timestamp('windowStart', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.bucket, t.windowStart] })])

// Outbound webhooks (API-5): HMAC-signed POSTs on run and dataset events.
export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  url: text('url').notNull(),
  description: text('description'),
  /** ["run.succeeded", "run.failed", "dataset.updated"] */
  events: jsonb('events').notNull().default([]),
  /** Signing secret, encrypted like data source credentials. */
  secret: jsonb('secret').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('webhooks_workspace_idx').on(t.workspaceId)])

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  webhookId: text('webhookId').notNull(),
  event: text('event').notNull(),
  payload: jsonb('payload').notNull(),
  /** pending | delivered | failed */
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('nextAttemptAt', { withTimezone: true }).notNull().defaultNow(),
  responseStatus: integer('responseStatus'),
  error: text('error'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('deliveredAt', { withTimezone: true }),
}, (t) => [index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt), index('webhook_deliveries_webhook_idx').on(t.webhookId, t.createdAt)])

// Reusable Map-step field lists (MP-10).
export const mappingTemplates = pgTable('mapping_templates', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  /** Map step fields: [{ from, to, type, transforms }] */
  fields: jsonb('fields').notNull(),
  keepUnmapped: boolean('keepUnmapped').notNull().default(false),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('mapping_templates_workspace_name_idx').on(t.workspaceId, t.name)])

// Daily data quality measurements per dataset (DQ-4).
export const datasetQualitySnapshots = pgTable('dataset_quality_snapshots', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  datasetName: text('datasetName').notNull(),
  /** YYYY-MM-DD (Asia/Jakarta) */
  day: text('day').notNull(),
  rowCount: integer('rowCount').notNull().default(0),
  /** Percentages 0–100; null when not measurable. */
  completeness: numeric('completeness'),
  uniqueness: numeric('uniqueness'),
  validity: numeric('validity'),
  freshnessHours: numeric('freshnessHours'),
  score: numeric('score'),
  takenAt: timestamp('takenAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('dataset_quality_day_idx').on(t.workspaceId, t.datasetName, t.day)])

// SCIM 2.0 provisioning (GV-8): the identity provider creates, updates and deactivates workspace members.
/** Bearer tokens the IdP uses (only a SHA-256 hash stored; shown once). */
export const scimTokens = pgTable('scim_tokens', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  hash: text('hash').notNull().unique(),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('lastUsedAt', { withTimezone: true }),
  revokedAt: timestamp('revokedAt', { withTimezone: true }),
  revokedBy: text('revokedBy'),
}, (t) => [index('scim_tokens_workspace_idx').on(t.workspaceId)])

/** A SCIM User resource: one Nexus account provisioned into one workspace. */
export const scimUsers = pgTable('scim_users', {
  /** SCIM resource id. */
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  userId: text('userId').notNull(),
  userName: text('userName').notNull(),
  externalId: text('externalId'),
  active: boolean('active').notNull().default(true),
  /** name, displayName, emails, title … as the IdP sent them (returned on GET). */
  attributes: jsonb('attributes').notNull().default({}),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('scim_users_member_idx').on(t.workspaceId, t.userId), index('scim_users_name_idx').on(t.workspaceId, t.userName)])

/** A SCIM Group; members of a group mapped to a role get that role (the highest of their groups). */
export const scimGroups = pgTable('scim_groups', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  displayName: text('displayName').notNull(),
  externalId: text('externalId'),
  /** Role for members (admin … viewer); null = the group doesn't set roles. */
  role: text('role'),
  /** SCIM user ids. */
  members: jsonb('members').notNull().default([]),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('scim_groups_workspace_idx').on(t.workspaceId)])

// Nexus Agent (#13): a small program inside a customer's network that reaches their
// databases for Nexus. It only connects out (polls for tasks); credentials stay on its host.
export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  name: text('name').notNull(),
  /** First characters of the token, to recognize it. Only a SHA-256 hash of the token is stored. */
  prefix: text('prefix').notNull(),
  tokenHash: text('tokenHash').notNull().unique(),
  createdBy: text('createdBy').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('lastSeenAt', { withTimezone: true }),
  version: text('version'),
  hostname: text('hostname'),
  /** What the agent offers: [{ name, type, writable }] (never credentials), and whether it has a local AI model. */
  connections: jsonb('connections').notNull().default([]),
  ai: jsonb('ai'),
  revokedAt: timestamp('revokedAt', { withTimezone: true }),
  revokedBy: text('revokedBy'),
}, (t) => [index('agents_workspace_idx').on(t.workspaceId)])

/** Work for an agent: queued by Nexus, claimed by the agent's poll, answered with a result. */
export const agentTasks = pgTable('agent_tasks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspaceId').notNull(),
  agentId: text('agentId').notNull(),
  /** test | scan | sample | readChunk | readRows | write | liveQuery | ai */
  op: text('op').notNull(),
  /** Connection name and arguments (no credentials). */
  payload: jsonb('payload').notNull(),
  /** queued | claimed | done | failed | expired */
  status: text('status').notNull().default('queued'),
  result: jsonb('result'),
  error: text('error'),
  retryable: boolean('retryable'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimedAt', { withTimezone: true }),
  finishedAt: timestamp('finishedAt', { withTimezone: true }),
}, (t) => [index('agent_tasks_queue_idx').on(t.agentId, t.status, t.createdAt)])
