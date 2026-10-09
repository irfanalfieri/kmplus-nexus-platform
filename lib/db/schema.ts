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
  expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
})

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
  config: jsonb('config').notNull(),
  schedule: jsonb('schedule'),
  enabled: boolean('enabled').default(false),
  version: integer('version').default(1),
  lastRunAt: timestamp('lastRunAt', { withTimezone: true }),
  lastRunStatus: text('lastRunStatus'),
  /** Next scheduled run (UTC); null when manual or disabled. Indexed for the scheduler tick. */
  nextRunAt: timestamp('nextRunAt', { withTimezone: true }),
  /** Runtime state, e.g. { watermark: { column, value } } for incremental sync. Not versioned. */
  state: jsonb('state'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('pipelines_next_run_idx').on(t.nextRunAt), index('pipelines_workspace_idx').on(t.workspaceId)])

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
  row: jsonb('row').notNull(),
  errors: jsonb('errors').notNull(),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('pipeline_run_rejects_run_idx').on(t.runId)])

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
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
})

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

