# KMPlus Nexus — Product Requirements Document

> **Connect Anything. Transform Everything. Build Once. Reuse Everywhere.**

| | |
|---|---|
| **Product** | KMPlus Nexus |
| **Category** | Enterprise Integration Platform as a Service (EiPaaS) + Enterprise Data Platform |
| **Owner** | Irfan Widyatmoko (irfan.widyatmoko@kmplus.co.id) |
| **Status** | Living document. Phase 1 (Foundation) is in progress |
| **Last updated** | 2026-10-08 |
| **Production URL** | https://kmplus-nexus-platform.vercel.app |
| **Repo** | github.com/irfanalfieri/kmplus-nexus-platform |

**Read this first if you are building Nexus (human or AI).** Sections 1–9 say *what* and *why*. Section 10 shows what's built today. Sections 11–13 say *how* to build it. Section 14 is the checklist for every change.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Problem](#2-problem)
3. [Goals, non-goals, success metrics](#3-goals-non-goals-success-metrics)
4. [Target customers & personas](#4-target-customers--personas)
5. [Core concepts & glossary](#5-core-concepts--glossary)
6. [Key user journeys](#6-key-user-journeys)
7. [Functional requirements by layer](#7-functional-requirements-by-layer)
8. [Unified Enterprise Data Model](#8-unified-enterprise-data-model)
9. [Non-functional requirements](#9-non-functional-requirements)
10. [Current implementation status](#10-current-implementation-status)
11. [Architecture](#11-architecture)
12. [Data model (database)](#12-data-model-database)
13. [Roadmap & phase exit criteria](#13-roadmap--phase-exit-criteria)
14. [Build guide for vibe coding](#14-build-guide-for-vibe-coding)
15. [Packaging & pricing](#15-packaging--pricing)
16. [Risks & open questions](#16-risks--open-questions)

---

## 1. Executive summary

Most enterprise software vendors sell applications. **KMPlus Nexus sells the platform that powers them.**

Today, every KMPlus implementation (KMS, LMS, TMS, PMS, CMS, IMS) means building custom integrations for that client: HRIS sync, org structure import, SSO, payroll feeds. That work gets redone for every project, costs a lot to maintain, and depends on developers.

Nexus replaces this with a **no-code integration platform**. Business and IT teams use it to **connect, transform, govern, and distribute** enterprise data across every business application. It has two roles:

1. **Internal platform.** Every KMPlus product consumes standardized data (Employee, Organization, Position, …) from Nexus instead of building its own connectors.
2. **Standalone product.** Customers buy Nexus by itself to integrate third-party systems (SAP → Power BI, Talenta → Active Directory, etc.).

**Strategic outcome:** KMPlus moves from an *application vendor* to an *enterprise platform company*. Integration stops being a recurring implementation cost and becomes a product line that earns recurring revenue.

```
External Systems                 KMPlus Nexus                       Consumers
────────────────                 ────────────                       ─────────
SAP · Oracle · SuccessFactors    Connect  → Transform → Govern      KMS · LMS · TMS
Talenta · Mekari · Workday   ──▶ Map      → Validate  → Catalog ──▶ PMS · CMS · IMS
MySQL · PostgreSQL · REST        Schedule → Monitor   → Version     Power BI · Tableau
CSV · Excel · Google Sheets                                         Custom apps · AI
SharePoint · Azure · AWS · LDAP          Unified Enterprise Data Model
```

---

## 2. Problem

Enterprises run dozens of disconnected systems: HRIS, ERP, LMS, CRM, payroll, identity providers, Active Directory, legacy databases, cloud apps, custom APIs, and Excel/CSV files that people email around.

Every implementation needs the same work again: custom connectors, data mapping, ETL development, scheduled sync, error handling, monitoring, and maintenance.

**Consequences**

| Pain | Who feels it | Today's cost (to validate with real project data) |
|---|---|---|
| Each client integration is custom-coded | KMPlus delivery team | Weeks of developer time per project |
| Integrations break silently (schema changes, expired passwords) | Client HR/IT, KMPlus support | Stale data in KMS/LMS, support tickets |
| No one knows which system is the "source of truth" | Data stewards, auditors | Duplicate/conflicting employee records |
| Business users can't get cross-system data without IT | HR analysts, managers | Manual Excel merges, slow reporting |
| No audit trail of who changed what data flow | Compliance, auditors | Risk under UU PDP (Indonesia's Personal Data Protection Law, No. 27/2022) |

---

## 3. Goals, non-goals, success metrics

### Goals
- **G1.** A non-developer can connect a source, map it to a standard domain, and schedule a sync in **under 30 minutes** for a supported connector.
- **G2.** KMPlus products (starting with KMS and LMS) consume Employee/Organization/Position data **only through Nexus**, with no product-specific connectors.
- **G3.** Every pipeline run is observable: status, row counts, errors, and quarantined records, with retry.
- **G4.** Enterprise-grade governance: RBAC, audit log, encrypted secrets, versioned pipelines.
- **G5.** Sellable on its own, with a connector marketplace and premium connectors.

### Non-goals (for now)
- Not a full data warehouse or lakehouse. Nexus caches and serves data but doesn't replace Snowflake or BigQuery.
- Not a general BI tool. The Dashboard Builder covers operational dashboards; Power BI/Tableau stay first-class consumers.
- Not a real-time streaming platform. Sub-second CDC/Kafka-scale streaming is out of scope; minute-level latency is the target.
- Not an iPaaS for arbitrary consumer apps (Zapier-style). The focus is enterprise HR, ERP, and identity data.
- No custom code nodes in Phase 1–3. A sandboxed "Script" node may come in Phase 5.

### Success metrics
| Metric | Target (12 months after GA) |
|---|---|
| Time-to-first-successful-sync (new customer) | < 1 day (vs. weeks today) |
| Integration effort per KMPlus implementation | −70% developer hours |
| Pipeline run success rate | ≥ 99% (excluding source outages) |
| Mean time to detect a failed sync | < 5 minutes (alerting) |
| KMPlus products consuming Nexus domains | ≥ 3 (KMS, LMS, PMS) |
| Standalone Nexus customers | ≥ 5 paying |
| Connectors in catalog (production-grade) | ≥ 20 |

---

## 4. Target customers & personas

### Customer segments
| Segment | Notes |
|---|---|
| **Primary:** Large enterprises with many disconnected systems | Usually SAP/Oracle + local HRIS + legacy DBs |
| **Secondary:** Government institutions | Often on-prem only, strict data residency, LDAP/AD-heavy |
| **Tertiary:** Holding companies with many subsidiaries | Need **multi-tenant** separation and group-level consolidation |

**Industries:** manufacturing, energy, mining, banking, telecommunications, healthcare, education, public sector.

**Regional context (missing from the original concept):** the primary market is Indonesia. This means:
- Local HRIS connectors (Talenta/Mekari, LinovHR, Gadjian, Darwinbox) count as much as SAP.
- **UU PDP compliance**: consent, data-minimization, and breach-notification support matter.
- Many customers need **on-prem or private-network connectivity** (see the Nexus Agent, §11.3).
- UI must support **Bahasa Indonesia and English**.

### Personas & roles

| Persona | Role in RBAC | Goals | Main screens |
|---|---|---|---|
| **Integration Administrator** (client IT / KMPlus implementer) | `admin` | Connect systems, build pipelines, manage secrets | Data Sources, Connectors, Pipelines, Scheduler |
| **Data Steward** (HR data owner) | `steward` | Make sure data is correct; fix bad records; own definitions | Data Quality, Catalog, Mapping |
| **Business Analyst** (HR analytics, finance) | `analyst` | Find and combine datasets, build dashboards | Catalog, Dashboard Builder |
| **Auditor** (internal audit, compliance) | `auditor` | See who changed what and who accessed which data; read-only | Audit Log, Versions, Governance |
| **Viewer** (managers, execs) | `viewer` | Read dashboards and pipeline health | Dashboard, Monitoring |
| **Pipeline Operator** *(added)* | `operator` | Run, retry, and monitor pipelines without editing them | Monitoring, Pipelines (run-only) |
| **KMPlus Platform Admin** *(added)* | super-admin (internal) | Manage tenants, licenses, the connector catalog | Back-office (future) |

**Permission matrix (target)**

| Action | admin | steward | analyst | operator | auditor | viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Manage data sources & secrets | ✅ | | | | | |
| Install/purchase connectors | ✅ | | | | | |
| Create/edit pipelines, mappings, rules | ✅ | ✅ (mappings, rules) | | | | |
| Approve pipeline promotion to prod | ✅ | ✅ | | | | |
| Run / retry pipelines | ✅ | ✅ | | ✅ | | |
| Fix quarantined records | ✅ | ✅ | | | | |
| Browse catalog / preview data | ✅ | ✅ | ✅ | ✅ | ✅ | masked |
| Build dashboards | ✅ | ✅ | ✅ | | | |
| View audit log & versions | ✅ | ✅ | | | ✅ | |
| Manage users & roles | ✅ | | | | | |

---

## 5. Core concepts & glossary

Use these terms consistently in code, UI, and docs.

| Term | Definition |
|---|---|
| **Workspace (Tenant)** | Top-level isolation boundary, usually one customer org or one subsidiary. Every record belongs to exactly one workspace. *(Not implemented yet; today records are scoped by `userId`.)* |
| **Environment** | `dev`, `staging`, or `prod` inside a workspace. Pipelines are promoted between environments. |
| **Connector** | A *type* of integration (e.g., "MySQL Connector v1.5.2") from the catalog. Defines credential fields and implements test/scan/sample/read/write. |
| **Connector Install** | A workspace's licensed/installed copy of a connector (free = included, premium = must be purchased). |
| **Data Source** | A configured *instance* of a connector with credentials, e.g., "SAP Production (Jakarta)". |
| **Destination** | A data source used as a write target, or a Nexus-managed dataset. |
| **Schema Scan** | A snapshot of a source's tables/entities/objects and columns, taken on test or refresh. |
| **Dataset** | A named, cataloged table of data that Nexus can serve, either *raw* (mirrors a source object) or *curated* (output of a pipeline, often a domain entity). |
| **Domain / Domain Entity** | A standardized business object in the Unified Enterprise Data Model (Employee, Organization, …). |
| **Pipeline** | A versioned directed graph of **nodes** that moves data from sources to destinations. |
| **Node** | One step in a pipeline (Source, Filter, Transform, Join, Validate, Save, Notify, …). |
| **Mapping** | Source field → target field rules, with transformations; usually lives inside a Transform/Map node. |
| **Business Rule** | A reusable IF/THEN rule (filter, route, notify, approve) referenced by pipelines. |
| **Trigger / Schedule** | What starts a run: manual, cron, webhook, event, or API. |
| **Run (Execution)** | One execution of a pipeline version, with per-node stats and logs. |
| **Quarantine** | Records that failed validation in a run. They're stored aside for a steward to fix and replay. |
| **Watermark** | The last-synced cursor (timestamp/ID) used for incremental syncs. |
| **Nexus Agent** | A lightweight on-prem runner that lets Nexus reach systems behind a customer firewall *(added; see §11.3)*. |
| **Nexus Data API** | The read API that KMPlus apps and external consumers use to query domain datasets. |

---

## 6. Key user journeys

### J1 — Connect a source (Phase 1)
`Data Sources → Add Source → choose connector → enter credentials → Test Connection → Schema scan preview → Save`
- If the connector is premium and not purchased, the user is sent to the Marketplace first.
- On success, the source shows `connected`, the last-connected time, and the number of discovered tables.
- The user can open the **Schema Explorer** and **Sample Data Preview** (first 25 rows).

### J2 — Build an Employee sync (Phase 1–2)
1. Create Pipeline "Employee Sync". Pick template *HRIS → Employee Domain*.
2. Source node: `SAP.PA0001`. Filter node: `status = Active`. Join node: `Organization` on `ORG_CODE`.
3. Map node: `PERNR → employee_code`, `ENAME → full_name` (Trim, Title Case), `BEGDA → hire_date` (date `yyyyMMdd` → ISO).
4. Validate node: email format, required fields, manager exists.
5. Save node: upsert into the `employee` domain on key `employee_code`.
6. **Test Run** on 100 sample rows. A preview shows per-node outputs.
7. Schedule: weekdays 01:00 WIB. Alerts: email + Teams on failure.
8. Submit for approval → steward approves → promoted to `prod`.

### J3 — Investigate a failure (Phase 1)
Monitoring shows `Payroll Sync 🔴 Failed` → open the run → the node timeline shows `Validate` failed for 312 of 48,000 rows → the error says "Invalid date format in `BEGDA`" → (Phase 4: AI suggests "Insert Date Formatter before Validation") → user edits, re-runs, or **replays only the quarantined rows**.

### J4 — Fix bad records (Phase 2)
Data Quality → Quarantine → filter by rule "Missing Organization" → steward edits rows inline or bulk-assigns the org → **Replay** pushes only fixed rows to the destination. The full pipeline does not run again.

### J5 — Business user finds data and builds a dashboard (Phase 3)
Catalog → search "training hours" → finds `LMS.TrainingHistory` (owner, freshness, column descriptions) → "Use in dashboard" → the Dashboard Builder combines `SAP.Employee` headcount with LMS training hours by department.

### J6 — A KMPlus product consumes Nexus (Phase 3)
KMS calls `GET /api/v1/domains/employee?updated_since=…` with a workspace API key. It gets standardized employees and needs no SAP-specific code.

---

## 7. Functional requirements by layer

**Priority:** P0 = required for the phase to ship · P1 = should have · P2 = nice to have.
**Status:** ✅ real/working · 🟡 partial · 🎭 UI mock only (hardcoded data) · ⬜ not started. See §10 for details.

### Layer 1 — Data Source Manager (Phase 1) · 🟡

The central registry for every connected system.

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| DS-1 | Create a data source from an installed connector using the connector's credential form | P0 | ✅ |
| DS-2 | Test the connection and show a clear success/error message (auth failed, host unreachable, timeout, SSL) | P0 | ✅ |
| DS-3 | Schema scan on test: list tables/entities, columns, types, PKs, row counts; store the result as a snapshot | P0 | ✅ |
| DS-4 | Sample data preview (≤ 25 rows) per table | P0 | ✅ |
| DS-5 | Edit, rename, and delete a source; deletion is blocked if pipelines reference it (show dependents) | P0 | 🟡 (no dependency check) |
| DS-6 | **Credentials encrypted at rest**; never returned to the client after save (show `••••` + "replace") | P0 | ✅ (AES-256-GCM, `lib/security/credentials.ts`; key rotation not yet supported) |
| DS-7 | Periodic health check (e.g., every 15 min) and status history | P1 | ⬜ |
| DS-8 | Schema drift detection: compare the new scan with the previous one and flag added/removed/changed columns used by pipelines | P1 | ⬜ |
| DS-9 | Supported source types: Database, REST, GraphQL, SOAP, OData, LDAP/AD, File (CSV/Excel upload), Cloud Storage (S3/Azure Blob/GCS), SFTP/FTP, Message Queue | P0 for DB/REST/File; others P1–P2 | 🟡 |
| DS-10 | Connection via **Nexus Agent** for private networks (choose "Direct" or "Via Agent") | P1 | ⬜ |
| DS-11 | Source ownership + tags + environment (dev/staging/prod credentials per source) | P1 | ⬜ |

**Acceptance (DS-1..4):** A user with a reachable MySQL DB can add it, see "Connected · 42 tables", open a table, and see 25 real rows in under 10 seconds.

### Layer 2 — Connector Marketplace (Phase 1) · 🟡

Pre-built connectors, installable in one click.

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| CM-1 | Catalog listing with category, version, description, free/premium badge, installed state | P0 | ✅ |
| CM-2 | Install / uninstall; free connectors are pre-installed on account creation | P0 | ✅ |
| CM-3 | Premium connectors need a purchase (license) before install | P0 | 🟡 (purchase is simulated; no billing) |
| CM-4 | Connector detail page: docs, required permissions on the source system, supported operations (read / write / incremental / CDC) | P1 | ⬜ |
| CM-5 | Connector versioning: upgrade notice, changelog, pinning per data source | P2 | ⬜ |
| CM-6 | Public Connector SDK (Phase 5) | P2 | ⬜ |

**Connector catalog (target) and current state**

| Category | Connectors | Built today |
|---|---|---|
| HR | SAP SuccessFactors, SAP HCM (OData), Oracle HCM, Workday, **Talenta (Mekari)**, Darwinbox, LinovHR | SAP (OData) ✅ |
| ERP | SAP S/4HANA, Oracle EBS | SAP (OData) ✅ |
| CRM / SaaS | Salesforce | Salesforce (OAuth) ✅ premium |
| Identity | Azure AD / Entra ID (Graph), Active Directory (LDAP), OpenLDAP, Google Workspace Directory, Okta | ⬜ |
| Productivity | Microsoft 365 / SharePoint (Graph), Google Sheets, Google Drive | ⬜ |
| Databases | PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, MongoDB, Supabase | MySQL ✅, Oracle ✅, Supabase ✅, Postgres driver ✅ (not in catalog) |
| Warehouse | Snowflake, BigQuery | Snowflake ✅ premium |
| Storage / Files | AWS S3, Azure Blob, GCS, SFTP, CSV/Excel upload | ⬜ |
| Generic | REST (Postman-style), GraphQL, SOAP, Webhook (inbound) | REST ✅ |
| KMPlus products | KMS, LMS, TMS, PMS, CMS, IMS (first-class destinations) | ⬜ |

**Every connector must implement:** `test`, `scan`, `sample`. From Phase 1 it must also implement `read` (full + incremental), and `write` (insert/upsert) where the target supports it. See §14.3.

### Layer 3 — Data Mapping Studio (Phase 2; basic mapping pulled into Phase 1) · 🎭

Visual field mapping instead of SQL.

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| MP-1 | Two-pane mapper: source columns ↔ target (domain or destination) columns; drag-and-drop or dropdown | P0 | 🎭 (column-mapping modal exists) |
| MP-2 | Auto-map by exact/similar name (`EMP_ID` → `employee_code` via synonym list) | P0 | ⬜ |
| MP-3 | Type conversion with explicit error behavior (fail row / null / default) | P0 | ⬜ |
| MP-4 | Built-in transforms: Trim, Upper, Lower, Title Case, Replace, Regex extract/replace, Date parse/format (with timezone), Number format, Concatenate, Split, Substring, Lookup (table), Null handling (coalesce), Default value, Conditional (IF/CASE), Hash (for masking) | P0 for the first 10, P1 rest | ⬜ |
| MP-5 | Transform chaining per field (`Trim → Upper → Lookup`) | P0 | ⬜ |
| MP-6 | Lookup tables: user-uploaded or dataset-backed (e.g., `ORG_CODE → org_name`) | P1 | ⬜ |
| MP-7 | Nested objects / JSON flatten + build (for REST sources and destinations) | P1 | ⬜ |
| MP-8 | Relationship mapping (FK resolution: `MANAGER_ID` → `employee.id`) | P1 | ⬜ |
| MP-9 | Live preview: apply the mapping to sample rows and show before/after | P0 | ⬜ |
| MP-10 | Mappings saved as reusable **mapping templates** (e.g., "SAP PA0001 → Employee") | P1 | ⬜ |

**Mapping must be stored as declarative JSON, not code.** That keeps it versionable, diffable, AI-generatable, and safe to run. See §12.2.

### Layer 4 — Pipeline Designer (Phase 1) · 🎭

The visual workflow engine (inspired by NiFi, Power Automate, n8n, and Node-RED).

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| PD-1 | Canvas with nodes and edges (DAG); add, connect, configure, and delete nodes | P0 | 🎭 (linear step list, mock pipelines) |
| PD-2 | Pipelines persisted to the DB with a versioned definition (`nodes`, `edges`, `settings`) | P0 | 🟡 (server actions exist; UI uses `MOCK_PIPELINES`) |
| PD-3 | **Real execution engine**: runs the DAG, streams batches between nodes, records per-node stats | P0 | ⬜ (`executePipeline` writes random numbers via `setTimeout`) |
| PD-4 | Test run on a sample (N rows) with per-node output preview, no writes to destinations | P0 | 🎭 |
| PD-5 | Validation before save: no cycles, every node configured, types compatible | P0 | ⬜ |
| PD-6 | Write modes on Save: insert, upsert (on key), replace (truncate+load), soft-delete missing | P0 | ⬜ |
| PD-7 | Incremental sync using a watermark column, with a full-resync option | P0 | ⬜ |
| PD-8 | Templates: "HRIS → Employee", "AD → Users", "CSV → Dataset", "Dataset → Power BI" | P1 | ⬜ |
| PD-9 | Sub-pipelines / reusable components (call another pipeline as a node) | P2 | ⬜ |
| PD-10 | Per-pipeline settings: timeout, retries (count + backoff), concurrency (1 = no overlap), batch size, error threshold (abort if > X% rows fail) | P0 | ⬜ |

**Node catalog**

| Node | Purpose | Phase |
|---|---|:-:|
| Source | Read from a data source object (full/incremental), or from a Nexus dataset | 1 |
| Filter | Keep rows that match conditions (uses the rule builder UI) | 1 |
| Map / Transform | Apply a mapping (Layer 3) | 1 |
| Validate | Apply data-quality rules; failing rows go to quarantine | 1 |
| Save / Destination | Write to a destination or Nexus dataset (insert/upsert/replace) | 1 |
| Notification | Email, Microsoft Teams, Slack, webhook (WhatsApp later) | 1 |
| Join | Inner/left join two streams on keys | 2 |
| Merge / Union | Combine streams with the same schema | 2 |
| Split / Router | Route rows to branches by condition | 2 |
| Decision | Branch the whole run (e.g., if row count = 0 → notify and stop) | 2 |
| Aggregate | Group by + count/sum/avg/min/max | 2 |
| Deduplicate | Remove duplicates by key, keeping first/last/most recent | 2 |
| Lookup | Enrich from a dataset/lookup table | 2 |
| API Call | Call a REST endpoint per row or per batch | 2 |
| SQL Query | Run a parameterized read-only query on a source | 2 |
| File Export | Write CSV/Excel/JSON/Parquet to storage or SFTP | 2 |
| Dashboard Refresh | Invalidate the cache for dependent dashboards/datasets | 3 |
| AI Processing | LLM classify/extract/summarize a field (with cost limits) | 4 |
| Approval | Pause the run until a human approves (e.g., before bulk deletes) | 3 |

### Layer 5 — Scheduling & Automation (Phase 1) · 🎭

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| SC-1 | Trigger types: Manual, Hourly, Daily, Weekly, Monthly, CRON, Webhook (signed URL), Event (another pipeline finished / dataset updated), API (`POST /api/v1/pipelines/:id/runs`) | P0 for manual/presets/cron; P1 webhook/API; P2 event | ⬜ |
| SC-2 | Timezone per schedule (default **Asia/Jakarta**) with a human-readable preview ("Every weekday at 01:00 WIB"), plus the next 5 run times | P0 | ⬜ |
| SC-3 | No overlapping runs by default; queue or skip policy | P0 | ⬜ |
| SC-4 | Pause/resume schedule; maintenance windows / blackout dates | P1 | ⬜ |
| SC-5 | Pipeline chaining: run B after A succeeds | P1 | ⬜ |
| SC-6 | Event triggers from source systems (e.g., SAP event → run immediately) via inbound webhook | P1 | ⬜ |

### Layer 6 — Monitoring Center (Phase 1) · 🎭

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| MN-1 | Today's jobs summary: successful / running / failed / queued, plus a trend over 7/30 days | P0 | 🎭 |
| MN-2 | Pipeline health list: 🟢 Healthy · 🟡 Delayed (missed SLA / running long) · 🔴 Failed · ⚪ Paused | P0 | 🎭 |
| MN-3 | Run detail: timeline per node, rows in/out/error per node, duration, logs, error message, stack trace (admin only) | P0 | ⬜ |
| MN-4 | Actions: Retry run, Retry from failed node, Replay quarantined rows, Cancel running, Download logs | P0 retry/cancel; P1 others | ⬜ |
| MN-5 | Alerts: on failure, on delay (SLA breach), on error rate > threshold; channels email/Teams/Slack/webhook; per-pipeline subscribers | P0 email; P1 others | ⬜ |
| MN-6 | Root-cause hints: classify errors (auth, network, schema drift, validation, timeout, rate limit) with suggested fixes; AI-assisted in Phase 4 | P1 | ⬜ |
| MN-7 | Log retention: 30 days of detailed logs, 1 year of run summaries (configurable per plan) | P1 | ⬜ |

### Layer 7 — Data Quality (Phase 2) · 🎭

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| DQ-1 | Rule types: required, unique, format (email/phone/NIK/NPWP), range, allowed values, referential (FK exists in dataset), date validity, cross-field (end ≥ start), custom expression | P0 | ⬜ |
| DQ-2 | Rule severity: **error** (quarantine the row), **warning** (pass + flag), **info** | P0 | ⬜ |
| DQ-3 | Quarantine store per run; steward UI to filter, edit inline, bulk-fix, approve, and **replay only fixed rows** | P0 | ⬜ |
| DQ-4 | Quality score per dataset (completeness, validity, uniqueness, freshness) with history | P1 | 🎭 |
| DQ-5 | Built-in HR rule pack: Employee email exists, duplicate employee, missing organization, invalid position, invalid date, invalid/circular manager, missing required fields | P0 | ⬜ |

### Layer 8 — Data Catalog (Phase 2) · 🎭

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| DC-1 | Auto-register datasets from schema scans (raw) and pipeline outputs (curated) | P0 | ⬜ |
| DC-2 | Search by name, description, column, tag, owner, source | P0 | 🎭 |
| DC-3 | Dataset page: description, owner, steward, classification (Public / Internal / Confidential / **PII**), columns with business descriptions, freshness, row count, quality score, sample (masked by role) | P0 | 🎭 |
| DC-4 | **Lineage**: the source(s) → pipelines → dataset → consumers (dashboards, APIs, KMPlus apps) | P1 | ⬜ |
| DC-5 | Business glossary linking terms ("Active Employee") to datasets/columns | P2 | ⬜ |
| DC-6 | Request access workflow for restricted datasets | P2 | ⬜ |

### Layer 9 — Data Virtualization (Phase 3) · ⬜

| ID | Requirement | Pri |
|---|---|:-:|
| DV-1 | Per-dataset access mode: **Live query** (pass-through to the source) or **Cached** (materialized copy in Nexus storage) | P0 |
| DV-2 | Cache refresh: 5 min, 15 min, hourly, daily, or on pipeline completion | P0 |
| DV-3 | Live query guardrails: row limit, timeout, read-only, query pushdown where supported | P0 |
| DV-4 | Show freshness ("cached 12 min ago") everywhere the data is used | P0 |

### Layer 10 — Dashboard Builder (Phase 3) · 🎭

| ID | Requirement | Pri |
|---|---|:-:|
| DB-1 | Create a dashboard; add widgets (KPI, line, bar, pie, table, pivot) bound to catalog datasets | P0 |
| DB-2 | Widget query builder: dimension, measure, aggregation, filters, time grain; no SQL | P0 |
| DB-3 | Combine datasets from different systems in one dashboard; cross-dataset joins via domain keys (e.g., `employee_code`) | P1 |
| DB-4 | Dashboard filters (date range, org unit) applied to all widgets | P1 |
| DB-5 | Share with roles/users; embed in KMPlus apps; export PDF/PNG | P1 |
| DB-6 | Row-level security follows Governance policies | P0 |

### Layer 11 — Business Rules Engine (Phase 2) · 🎭

| ID | Requirement | Pri |
|---|---|:-:|
| BR-1 | Visual IF/THEN builder: conditions (field, operator, value; AND/OR groups) → actions | P0 |
| BR-2 | Actions: include/exclude row, set field value, calculate field, route to branch, notify, require approval, trigger pipeline | P0 |
| BR-3 | Rules are reusable and referenced by ID from Filter/Validate/Router nodes | P0 |
| BR-4 | Test a rule against sample rows | P1 |
| BR-5 | Rules stored as declarative JSON (same expression format as mapping conditions) | P0 |

Example rules: `IF employment_status = 'Active' → Import`; `IF department = 'Finance' → Notify HR`.

### Layer 12 — AI Integration Assistant (Phase 4) · 🎭

| ID | Capability | Behavior |
|---|---|---|
| AI-1 | **Smart Mapping** | Upload CSV / pick a source table → AI proposes source→target mappings plus transforms with confidence scores. The user must accept them; they're never auto-applied. |
| AI-2 | **Pipeline Recommendations / Generation** | "Sync active employees from Talenta to KMS daily" → a draft pipeline the user reviews |
| AI-3 | **Error Diagnosis** | Reads the run error + sample bad rows → explanation + a concrete fix ("Insert Date Formatter `dd/MM/yyyy` before Validate") with a one-click apply that creates a new draft version |
| AI-4 | **Connector Suggestions** | Detects a system from a URL, file headers, or an error signature → recommends a connector |
| AI-5 | **Natural-language catalog search** | "Where is training hours by department?" |

**AI guardrails (added):**
- Send schema/metadata and *masked* sample rows only. Never send raw PII to the LLM unless the workspace opts in.
- All AI output becomes a **draft** that needs human acceptance, and acceptance is audited.
- Per-workspace AI usage limits and logging.
- Model: latest Claude models via the Anthropic API (or Vercel AI Gateway).

### Layer 13 — Governance & Security (Phase 1 basics, Phase 2 full) · 🎭

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| GV-1 | **Workspaces (multi-tenancy)** with members and roles (§4 matrix) | P0 | ⬜ (currently per-user only) |
| GV-2 | RBAC enforced **server-side** in every server action / API route | P0 | ⬜ |
| GV-3 | Audit log for every create/update/delete/run/export/login/secret access, with actor, IP, user agent, and before/after diff | P0 | 🟡 (create/update/delete for some resources) |
| GV-4 | Secrets management: envelope encryption (AES-256-GCM, per-workspace data key, master key from KMS/env), rotation, no secrets in logs | P0 | ⬜ |
| GV-5 | Data masking policies per column classification (full mask, partial `****1234`, hash), applied in preview, catalog, API, and dashboards by role | P1 | 🎭 |
| GV-6 | Approval workflow for promoting pipelines to `prod` and for destructive write modes | P1 | ⬜ |
| GV-7 | Environment promotion dev → staging → prod, with per-environment source credentials | P1 | ⬜ |
| GV-8 | SSO: SAML 2.0 / OIDC (Azure AD, Google, Okta) + SCIM user provisioning; MFA for password logins | P1 | ⬜ (email/password only) |
| GV-9 | Row-level access policies (e.g., subsidiary A sees only its employees) | P2 | 🎭 |
| GV-10 | Data retention policies per dataset; right-to-erasure support (UU PDP) | P2 | 🎭 |

### Layer 14 — Version Control (Phase 1 basics) · 🎭

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| VC-1 | Every save of a pipeline/mapping/rule creates an immutable version (v1, v2, …) with author, timestamp, and a change note | P0 | 🟡 (table exists, not wired) |
| VC-2 | Draft vs. published: schedules run only the *published* version; editing creates a draft | P0 | ⬜ |
| VC-3 | Visual diff between versions (nodes added/removed/changed, mapping changes) | P1 | 🎭 |
| VC-4 | Rollback = publish an older version as a new version (history is never rewritten) | P0 | 🎭 |
| VC-5 | Export/import pipelines as JSON (for moving between workspaces/environments and templates) | P1 | ⬜ |

### Cross-cutting: Nexus Data API (added; required for the "platform" promise)

| ID | Requirement | Pri |
|---|---|:-:|
| API-1 | Workspace API keys (scoped: read datasets, trigger pipelines), hashed at rest, revocable | P0 (Phase 3) |
| API-2 | `GET /api/v1/datasets/:name` with filtering, pagination (cursor), field selection, `updated_since` | P0 |
| API-3 | `GET /api/v1/domains/:entity` for Unified Enterprise Data Model entities | P0 |
| API-4 | `POST /api/v1/pipelines/:id/runs` (trigger) and `GET /api/v1/runs/:id` (status) | P1 |
| API-5 | Outbound webhooks: `dataset.updated`, `run.failed`, `run.succeeded` | P1 |
| API-6 | OpenAPI spec published; rate limits per key | P1 |

---

## 8. Unified Enterprise Data Model

Nexus doesn't expose raw source systems. It publishes **standardized business domains**, and applications consume these instead of querying SAP or Talenta directly.

**Design rules**
- Every entity has `id` (Nexus UUID), `workspace_id`, a natural key (e.g., `employee_code`), `source_system`, `source_id`, `valid_from` / `valid_to` (history), `created_at`, `updated_at`, `is_deleted`.
- When the same entity arrives from several sources, the **golden record** follows a configurable survivorship rule (source priority per field). This comes in Phase 3.
- Extensible: customers can add custom attributes (`attributes` JSONB) without schema changes.

**Core entities (v1)**

| Entity | Key fields | Relationships |
|---|---|---|
| **Employee** | employee_code, full_name, email, phone, national_id (NIK, PII), gender, birth_date (PII), hire_date, termination_date, employment_status (Active/Inactive/Terminated/Leave), employment_type (Permanent/Contract/Intern/Outsource), grade, work_location | → Organization, → Position, → manager (Employee), → Company |
| **Organization** | org_code, name, type (Company/Directorate/Division/Department/Unit), parent_org_code, cost_center, head_employee_code | self-hierarchy, → Company |
| **Position** | position_code, title, job_family, job_level, org_code, is_vacant, reports_to_position_code | → Organization, → Competency (required) |
| **Company** *(added)* | company_code, legal_name, country | parent of Organizations (for holding groups) |
| **Competency** | competency_code, name, category (Technical/Behavioral/Leadership), proficiency_scale | ↔ Position (required level), ↔ Employee (assessed level) |
| **Learning** | course_code, title, provider, type; **TrainingHistory**: employee_code, course_code, start/end, hours, status, score | → Employee |
| **Performance** | period, employee_code, kpi_code, target, actual, score, rating | → Employee, → Position |
| **Payroll** | period, employee_code, components (JSONB), gross, net (restricted classification) | → Employee |
| **Recruitment** | requisition, candidate, application, stage, offer | → Position |
| **Culture** | survey, response, engagement score | → Employee/Organization (often aggregated or anonymized) |
| **Innovation** | idea, submitter, status, impact | → Employee (IMS) |

**Product ↔ domain consumption**

| KMPlus product | Consumes |
|---|---|
| KMS (Knowledge) | Employee, Organization, Position, Competency |
| LMS (Learning) | Employee, Organization, Position, Competency → produces Learning |
| TMS (Talent) | Employee, Position, Competency, Performance |
| PMS (Performance) | Employee, Organization, Position → produces Performance |
| CMS (Culture) | Employee, Organization → produces Culture |
| IMS (Innovation) | Employee, Organization → produces Innovation |

---

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| **Security** | Credentials encrypted at rest (§GV-4); TLS everywhere; secrets never sent to the client or logs; OWASP top-10; dependency scanning; per-workspace isolation enforced in every query |
| **Privacy / compliance** | UU PDP (Indonesia): data classification, masking, access audit, retention, erasure. ISO 27001-ready controls. Data residency option (Jakarta region / on-prem) for government and banking |
| **Multi-tenancy** | Hard isolation by `workspace_id` on every table, and on every query through a helper. No cross-tenant reads, ever |
| **Performance** | UI interactions < 200 ms p95; schema scan < 15 s for 500 tables; sample preview < 5 s; pipeline throughput ≥ 10k rows/s for DB→DB simple mapping on standard workers |
| **Scale (v1 target)** | 50 workspaces, 500 pipelines, 10k runs/day, datasets up to 10M rows |
| **Reliability** | 99.5% control-plane availability; runs are **idempotent** (upserts + watermarks), resumable from the last committed batch; at-least-once delivery |
| **Long-running work** | Pipeline execution must **not** run inside web request handlers (serverless timeouts). Use a durable job queue/worker (§11.2) |
| **Observability** | Structured logs with `workspace_id`, `pipeline_id`, `run_id`; metrics per run/node; error tracking |
| **Localization** | English + Bahasa Indonesia UI; default timezone Asia/Jakarta; locale-aware number/date formats (IDR, `dd/MM/yyyy`) |
| **Accessibility** | WCAG 2.1 AA for core flows |
| **Browser support** | Latest Chrome, Edge, Firefox, Safari; desktop-first, tablet usable |

---

## 10. Current implementation status

*Snapshot from the codebase as of 2026-10-08. Update this table whenever a feature moves from mock to real.*

| Layer / area | Status | What's real | What's mock / missing |
|---|:-:|---|---|
| Auth | ✅ | Better Auth email/password, sessions (7 days), sign-in/up pages | SSO, MFA, workspaces, roles |
| Data Sources | ✅/🟡 | CRUD via server actions; real test + schema scan + sample via connector drivers; Schema Explorer & Sample Preview modals; credentials encrypted at rest and stripped from client payloads | No dependency checks; no health checks; no key rotation |
| Connector Marketplace | 🟡 | Catalog in code (`lib/connectors/catalog.ts`); per-user installs/purchase flags in DB | Purchase is a flag, with no billing; Postgres driver not in catalog |
| Connector drivers | 🟡 | SAP (OData), Oracle, MySQL, Postgres, REST (Postman-style form), Salesforce (OAuth), Snowflake, Supabase: **test / scan / sample** | No `read` (full/incremental) or `write` yet, so pipelines can't move real data |
| Pipeline Designer | 🎭 | Server actions for CRUD exist (`app/actions/pipelines.ts`); test/mapping/visualizer modals | UI uses `MOCK_PIPELINES`; execution is simulated (`setTimeout` + random numbers); no DAG canvas |
| Scheduler | ⬜ | `pipelines.schedule` JSONB column | No scheduler or worker |
| Monitoring | 🎭 | `execution_logs` table | UI is hardcoded `PIPELINE_HEALTH`/`CATALOG` arrays |
| Data Mapping | 🎭 | `data_mappings` table, column mapping modal | No transform engine |
| Data Quality | 🎭 | `data_quality_metrics` table | No rule engine or quarantine |
| Data Catalog | 🎭 | `data_catalog` table | UI mock data |
| Business Rules | 🎭 | `business_rules` table, UI builder | Not persisted or evaluated |
| Analytics / Dashboards | 🎭 | `dashboards` table | Placeholder UI |
| Version Control | 🎭 | `pipeline_versions` table | Not written on save |
| Governance | 🎭 | `audit_logs` (partially written), `governance_policies` table | RBAC/tenants/policies are UI state only |
| AI Assistant | 🎭 | — | Mock UI |
| Data API | ⬜ | — | — |

**Known tech debt to fix early**
1. ~~Encrypt `data_sources.credentials`~~ Done (AES-256-GCM, `NEXUS_ENCRYPTION_KEY`). Next: key rotation (`kid` in the envelope) and a per-workspace data key.
2. IDs use `` `prefix_${Date.now()}` ``, which collides under concurrency. Switch to `crypto.randomUUID()` (keep the prefix if you want: `src_<uuid>`).
3. Server actions take `data: any`. Add **zod** validation for every action input.
4. `getUserId()` is copy-pasted in every action file. Extract it to `lib/auth/session.ts` and later replace it with `requireWorkspaceRole(role)`.
5. There are both `package-lock.json` and `pnpm-lock.yaml`. Vercel uses pnpm, so **use pnpm only** and delete `package-lock.json`.
6. No migrations folder is committed (`drizzle/`). The production DB drifted from `schema.ts` (missing `connector_installs`, lowercase columns), which crashed the Connectors page. `scripts/db-repair-schema.mjs` fixes the drift; long term, generate and commit Drizzle migrations.
7. No automated tests apart from the live scripts in `scripts/`.

---

## 11. Architecture

### 11.1 Current stack
| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS v4, shadcn/ui (`components/ui`), Base UI, lucide-react icons |
| Auth | Better Auth (email/password) on Postgres |
| Metadata DB | PostgreSQL via Drizzle ORM (`lib/db/schema.ts`), `pg` Pool |
| Mutations | Next.js **Server Actions** in `app/actions/*` |
| Connectors | Driver modules in `lib/connectors/drivers/*`, dispatched by `lib/connectors/runtime.ts` |
| Hosting | Vercel (auto-deploy on push to `main`); originally scaffolded with v0 |
| Package manager | **pnpm** (lockfile must stay in sync; Vercel runs `--frozen-lockfile`) |

### 11.2 Target architecture

```
┌──────────────────────────── Control plane (Next.js on Vercel) ────────────────────────────┐
│  UI (dashboard layers)  ·  Server Actions  ·  /api/v1 (Data API, webhooks)               │
│  Auth + Workspaces + RBAC  ·  Secrets service (encrypt/decrypt)  ·  Audit logger          │
└──────────────┬───────────────────────────────────────────────┬──────────────────────────────┘
               │ enqueue run (pipeline_id, version, trigger)   │ read metadata
               ▼                                               ▼
┌──────── Job queue / durable workflows ───────┐     ┌──── Metadata Postgres ────┐
│  scheduler tick (cron) → due pipelines       │     │ sources, pipelines, runs, │
│  run = durable workflow, step per node/batch │◀───▶│ versions, rules, catalog, │
│  retries, backoff, cancellation              │     │ audit, quarantine         │
└──────────────┬───────────────────────────────┘     └───────────────────────────┘
               │ execute
               ▼
┌──────── Execution workers ───────────────────┐     ┌──── Nexus data store ─────┐
│  connector.read() → transform → validate →   │────▶│ curated datasets / domain │
│  connector.write()  (batched, streaming)     │     │ tables (Postgres schema   │
│  per-node stats → run log                    │     │ per workspace, or         │
└──────────────┬───────────────────────────────┘     │ warehouse later)          │
               │ via outbound tunnel                 └───────────────────────────┘
               ▼
┌──────── Nexus Agent (on-prem, optional) ─────┐
│  runs inside customer network; pulls jobs    │
│  over HTTPS; reaches SAP/AD/SQL Server       │
└──────────────────────────────────────────────┘
```

**Key decisions (proposed; record in ADRs under `docs/adr/` when decided)**
- **ADR-1 Execution engine:** don't execute in server actions. Options: (a) Vercel Workflow / Queues + Fluid Compute functions for batches; (b) a separate Node worker service (e.g., on Fly/Railway/Azure Container Apps) with a Postgres-backed queue (pg-boss/Graphile Worker); (c) Temporal. **Recommendation:** (b) a Postgres-backed queue + Node worker, because it works the same on-prem, which government customers need.
- **ADR-2 Pipeline definition format:** a single JSON document (`nodes[]`, `edges[]`, `settings`) stored in `pipeline_versions.config`, validated by a zod schema shared by the UI and the engine. The current `pipeline_steps` table becomes redundant.
- **ADR-3 Expression language:** a JSON AST for conditions and transforms (no `eval`). It's shared by Mapping, Rules, Filter, Validate, and Router.
- **ADR-4 Curated data storage:** Postgres schema per workspace (`ws_<id>`) for v1; a warehouse option later.
- **ADR-5 Tenancy:** add `workspaces` + `workspace_members`; migrate every `userId` scope to `workspaceId`.

### 11.3 Nexus Agent (on-prem connectivity) — added
Many target customers (government, banking, mining) won't expose SAP/AD/SQL Server to the internet. The **Nexus Agent** is a small Docker container/Windows service that:
- registers to a workspace with a one-time token,
- opens an **outbound-only** HTTPS/WebSocket connection (no inbound firewall rules),
- receives connector jobs (test/scan/sample/read/write) and runs the same driver code locally,
- streams results back encrypted; credentials can be kept **only on the agent** (local vault),
- reports heartbeat and version; the UI shows agent status.

### 11.4 Connector interface (target)

```ts
interface ConnectorDriver {
  test(creds): Promise<ConnectionTestResult>
  scan(creds): Promise<SchemaScanResult>
  sample(creds, object, limit): Promise<Row[]>
  // Phase 1 additions:
  read(creds, object, opts: { columns?, watermark?: { column, after }, batchSize }): AsyncIterable<Row[]>
  write?(creds, object, rows: Row[], opts: { mode: 'insert'|'upsert'|'replace', keys?: string[] }): Promise<WriteResult>
  capabilities: { read: boolean; write: boolean; incremental: boolean; liveQuery: boolean }
}
```

---

## 12. Data model (database)

### 12.1 Existing tables (`lib/db/schema.ts`)
Auth: `user`, `session`, `account`, `verification` (Better Auth).
Product: `data_sources`, `connector_installs`, `connectors`, `pipelines`, `pipeline_steps`, `execution_logs`, `data_mappings`, `data_catalog`, `business_rules`, `data_quality_metrics`, `dashboards`, `pipeline_versions`, `audit_logs`, `governance_policies`, `integration_configs`.
All product tables are currently scoped by `userId`.

### 12.2 Required changes / additions
| Table | Purpose |
|---|---|
| `workspaces`, `workspace_members(workspace_id, user_id, role)` | Multi-tenancy + RBAC |
| `environments` | dev/staging/prod per workspace |
| `secrets(id, workspace_id, ciphertext, iv, key_version)` | Encrypted credentials; `data_sources.credentials` → `secret_id` |
| `pipeline_runs` (rename/extend `execution_logs`) | add `version`, `trigger`, `triggered_by`, `status` enum (`queued/running/succeeded/failed/canceled/partial`) |
| `pipeline_run_nodes` | per-node rows in/out/error, duration, error |
| `quarantine_records(run_id, node_id, row jsonb, errors jsonb, status, fixed_row jsonb)` | Data Quality fix & replay |
| `schedules(pipeline_id, type, cron, timezone, next_run_at, paused)` | Scheduler (instead of JSONB on `pipelines`) |
| `watermarks(pipeline_id, node_id, value)` | Incremental sync state |
| `datasets` (evolve `data_catalog`) | name, kind (raw/curated/domain), source_id/pipeline_id, schema, classification, owner, freshness, access_mode, cache_ttl |
| `lineage_edges(from_type, from_id, to_type, to_id)` | Catalog lineage |
| `api_keys(workspace_id, hashed_key, scopes, last_used_at)` | Data API |
| `alert_subscriptions`, `notifications` | Alerts |
| `agents(workspace_id, name, status, last_heartbeat, version)` | Nexus Agent |

**Pipeline definition JSON (v1 sketch)**
```json
{
  "schemaVersion": 1,
  "nodes": [
    { "id": "src", "type": "source", "config": { "dataSourceId": "src_…", "object": "PA0001", "mode": "incremental", "watermarkColumn": "AEDTM" } },
    { "id": "flt", "type": "filter", "config": { "ruleId": "rule_active_only" } },
    { "id": "map", "type": "map", "config": { "target": "domain:employee", "fields": [
      { "to": "employee_code", "from": "PERNR", "transforms": [{ "fn": "trim" }] },
      { "to": "hire_date", "from": "BEGDA", "transforms": [{ "fn": "parseDate", "format": "yyyyMMdd" }] }
    ] } },
    { "id": "val", "type": "validate", "config": { "rules": ["required:employee_code", "email:email"] } },
    { "id": "dst", "type": "save", "config": { "target": "domain:employee", "mode": "upsert", "keys": ["employee_code"] } }
  ],
  "edges": [["src","flt"],["flt","map"],["map","val"],["val","dst"]],
  "settings": { "batchSize": 1000, "retries": 3, "timeoutSec": 3600, "errorThresholdPct": 5 }
}
```

---

## 13. Roadmap & phase exit criteria

The original roadmap puts the **Data Mapping Studio in Phase 2**. A pipeline can't produce useful output without mapping, so **basic mapping (MP-1..5, MP-9) moves into Phase 1**. The same goes for minimal **workspaces, RBAC, and encrypted secrets**: they're hard to retrofit, and enterprise pilots need them.

### Phase 1 — Foundation *(current)*
Data Source Manager · Connector Marketplace · Pipeline Designer (linear → DAG) · basic Mapping · Scheduler · Monitoring · encrypted secrets · workspaces + basic roles · versioning (draft/published).

**Exit criteria:** an Employee sync from a real MySQL/SAP source into a Nexus `employee` dataset runs on a cron schedule in production, is visible in Monitoring with real row counts, alerts by email on failure, and can be retried. No mock data remains in the Sources, Connectors, Pipelines, or Monitoring screens.

### Phase 2 — Data Intelligence
Full Data Mapping Studio · Data Catalog (auto-registered) · Business Rules Engine · Data Quality + quarantine/replay · Join/Merge/Router nodes · SSO · environment promotion + approvals · identity connectors (Azure AD, LDAP) · Talenta connector · file sources (CSV/Excel/SFTP).

**Exit criteria:** a steward can fix quarantined records and replay them; the catalog shows lineage from source to dataset; one pilot customer runs ≥ 5 production pipelines.

### Phase 3 — Self-Service Analytics & Platform
Dashboard Builder · Data Virtualization (live/cached) · Unified Enterprise Data Model (golden records) · **Nexus Data API** · first KMPlus product (KMS or LMS) consuming Nexus · Nexus Agent GA.

**Exit criteria:** KMS consumes Employee/Organization only through the Nexus API in one customer deployment.

### Phase 4 — AI Platform
AI Smart Mapping · AI Pipeline Generation · AI Error Diagnosis · AI Connector Recommendations · NL catalog search.

**Exit criteria:** ≥ 60% of AI-suggested mappings are accepted without edits on the pilot dataset set.

### Phase 5 — Ecosystem
Public Connector SDK · marketplace with partner connectors · pipeline templates gallery · community extensions · partner program.

---

## 14. Build guide for vibe coding

*Rules for anyone (or any AI) adding code. Following them keeps the codebase consistent.*

### 14.1 Golden rules
1. **No new mock data.** New features read and write the real DB through server actions. If a layer is still mock, replacing the mock with real data is the task; don't add more mock.
2. **Every server action:** authenticate → (later: authorize role in workspace) → validate input with zod → scope every query by owner (`userId` today, `workspaceId` later) → write the audit log → `revalidatePath('/dashboard')`.
3. **Never send credentials to the client.** Decrypt only on the server, right before calling a driver.
4. **Declarative over code:** pipelines, mappings, rules, and policies are JSON validated by zod schemas. Never `eval` user expressions.
5. **Long work doesn't belong in request handlers.** Anything that can take > 10 s goes through the job queue (once it exists).
6. **pnpm only.** After changing dependencies, run `pnpm install` and commit `pnpm-lock.yaml`, or Vercel fails with `ERR_PNPM_OUTDATED_LOCKFILE`.
7. **Update §10 of this PRD** when something moves from 🎭 to ✅.

### 14.2 Where things live
| Need | Location |
|---|---|
| DB tables | `lib/db/schema.ts` (Drizzle) → `drizzle-kit generate` → commit `drizzle/` |
| Server mutations/queries | `app/actions/<area>.ts` (`'use server'`) |
| Connector catalog entry | `lib/connectors/catalog.ts` |
| Connector implementation | `lib/connectors/drivers/<slug>.ts` + dispatch in `lib/connectors/runtime.ts` + slug in `lib/connectors/types.ts` |
| Dashboard screens | `components/dashboard/layers/<layer>-layer.tsx`, nav in `components/dashboard/sidebar.tsx`, switch in `dashboard-layout.tsx` |
| Dialogs | `components/modals/*` |
| UI primitives | `components/ui/*` (shadcn; add with `pnpm dlx shadcn add <component>`) |
| Auth | `lib/auth.ts` (server), `lib/auth-client.ts` (client), route `app/api/auth/[...all]` |
| Live connector test scripts | `scripts/test-*.mjs` |

### 14.3 Recipe: add a connector
1. Add the slug to `ConnectorSlug` in `lib/connectors/types.ts`.
2. Add a `ConnectorDefinition` to `CONNECTOR_CATALOG` (credential fields, `includedByDefault`, `premium`).
3. Create `lib/connectors/drivers/<slug>.ts` exporting `test…`, `scan…`, `sample…` (and `read`/`write` once the interface lands). Return friendly error messages (no raw stack traces to users).
4. Add the cases to all three switches in `lib/connectors/runtime.ts`.
5. If it needs a custom form (OAuth, Postman-style), add it to `components/connectors/`.
6. Add a live test script `scripts/test-<slug>-live.mjs` that reads credentials from env vars.
7. Never log credentials.

### 14.4 Recipe: turn a mock layer into a real one
1. Confirm or extend the table in `lib/db/schema.ts`; generate a migration.
2. Write `app/actions/<area>.ts` with list/get/create/update/delete following the §14.1 rule 2 pattern.
3. Replace the hardcoded arrays in the layer with data loaded from the actions; add empty, loading, and error states.
4. Write audit logs; add a version row if the resource is versioned.
5. Update the §10 status table.

### 14.5 UI conventions
- Layer pages start with a header card (icon + `Badge` layer label + title + one-line description), then content cards (`rounded-xl border border-border bg-card p-5/6`).
- Status colors: healthy/success = green, delayed/warning = amber, failed/error = destructive, paused/draft = muted.
- Every list needs an **empty state** with a primary action ("Add your first data source").
- Destructive actions need a confirmation dialog that names the object.
- Use domain vocabulary from §5 exactly (Data Source, not "Connection"; Run, not "Job execution").
- Bahasa Indonesia strings: plan for i18n. Avoid hardcoding long copy deep in components.

### 14.6 Definition of done (every PR)
- [ ] Works against the real DB (no mock data introduced)
- [ ] Input validated; queries scoped to owner; audit log written
- [ ] No secrets in client bundles, logs, or error messages
- [ ] Empty/loading/error states present
- [ ] `pnpm build` passes locally; `pnpm-lock.yaml` in sync
- [ ] Migration committed if the schema changed
- [ ] PRD §10 updated if feature status changed

---

## 15. Packaging & pricing

*(Draft; the code already distinguishes free and premium connectors. To be validated with sales.)*

| Plan | For | Includes |
|---|---|---|
| **Embedded** (bundled with KMPlus apps) | Existing KMPlus customers | HR domains feeding KMPlus apps only; standard connectors; limited pipelines |
| **Professional** | Mid-size / single company | Standard connectors, N pipelines, daily+ schedules, catalog, data quality, 30-day logs |
| **Enterprise** | Large enterprises, holdings | Unlimited pipelines, premium connectors included, SSO/SCIM, environments + approvals, Nexus Agent, Data API, 1-year logs, SLA |
| **Government / On-prem** | Public sector | Self-hosted control plane + agent, data residency, enterprise support |

**Add-ons:** premium connectors (Salesforce, Snowflake, SAP SuccessFactors, Workday), AI Assistant credits, extra environments, implementation services.

**Pricing metrics to choose from:** number of pipelines, number of active data sources, rows synced/month, or employee headcount (familiar to HR buyers). **Open question.**

---

## 16. Risks & open questions

### Risks
| Risk | Impact | Mitigation |
|---|---|---|
| Building 14 layers at once; everything is a mock and nothing works end-to-end | High | Stick to Phase 1 exit criteria; one real end-to-end flow before widening |
| Pipelines executed in serverless request handlers time out | High | ADR-1 job queue/worker before the scheduler ships |
| Credential leak | Critical | Encrypted at rest since 2026-10-08; add key rotation + KMS-held master key before GA |
| On-prem systems unreachable from Vercel | High | Nexus Agent (Phase 2–3), or self-hosted deployment |
| Connector maintenance burden (SAP/Workday API changes) | Medium | Connector SDK, contract tests, versioned connectors |
| Competing with mature iPaaS (MuleSoft, Boomi, Workato, n8n) | Medium | Differentiate on the **HR domain model + KMPlus app integration + local HRIS + Indonesian compliance**, not generic connector count |
| PII exposure through AI features | High | Masked samples, opt-in, audit (§Layer 12 guardrails) |

### Open questions
1. Is Nexus multi-tenant SaaS first, or must v1 also ship as a self-hosted install for government?
2. Where is curated data stored long-term: the Nexus Postgres, the customer's warehouse, or both?
3. Pricing metric: pipelines, rows, sources, or headcount?
4. Which KMPlus product integrates first (KMS or LMS), and who owns that work?
5. Which HRIS do the first 3 pilot customers use? That decides connector priority.
6. Do we need write-back to source systems (e.g., push LMS completions to SAP) in Phase 2, or is it read-only into Nexus first?
7. Notification channels: is WhatsApp (common in Indonesia) required for alerts?
8. Should AI features run on customer data by default, or be opt-in per workspace?

---

### Product differentiators (reference)

| Traditional integration projects | KMPlus Nexus |
|---|---|
| Custom development | Visual configuration |
| One-off implementation | Reusable platform |
| Developer dependent | Business & IT collaboration |
| Project-specific | Organization-wide capability |
| Fixed integrations | Composable pipelines |
| Static dashboards | Dynamic data sources |
| Manual monitoring | Centralized observability |
| Limited reuse | Connector & pipeline marketplace |
| Generic data model | **HR-first Unified Enterprise Data Model** *(added)* |
| Cloud-only reach | **On-prem Agent for private networks** *(added)* |
