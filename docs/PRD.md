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
| DS-5 | Edit, rename, and delete a source; deletion is blocked if pipelines reference it (show dependents) | P0 | ✅ (inline rename, source/destination switch, re-test; delete blocked while pipelines use it) |
| DS-6 | **Credentials encrypted at rest**; never returned to the client after save (show `••••` + "replace") | P0 | ✅ (AES-256-GCM envelopes sealed with a per-workspace key derived from the master key, bound to source and workspace; key ids + rotation) |
| DS-7 | Periodic health check (e.g., every 15 min) and status history | P1 | ✅ (2026-10-17: per source every 5 min … daily or off, default 15 min; through the Nexus Agent for agent-backed sources; 30-day history with latency and 24 h / 7 day pass rates; the source shows failing after a failed check; managers alerted on the first failure and on recovery; "Check now" = Test connection) |
| DS-8 | Schema drift detection: compare the new scan with the previous one and flag added/removed/changed columns used by pipelines | P1 | ✅ (2026-10-17: every scan (Test connection, credential edits, a health check every 6 h) is compared with the previous one; removed tables / columns and type changes (by type family) are kept on the source until reviewed, with the published pipelines that read the table and name the column; alert to source managers; additions listed but never alert) |
| DS-9 | Supported source types: Database, REST, GraphQL, SOAP, OData, LDAP/AD, File (CSV/Excel upload), Cloud Storage (S3/Azure Blob/GCS), SFTP/FTP, Message Queue | P0 for DB/REST/File; others P1–P2 | 🟡 (Database, REST, LDAP/AD and **File upload (CSV/TSV/XLSX)** ✅, **cloud storage (S3-compatible, Azure Blob, GCS)** ✅, **observability (Prometheus, Elasticsearch/OpenSearch, Datadog, New Relic, Grafana)** ✅; 2026-10-17: **GraphQL** ✅ (queries as tables, cursor paging), **SOAP** 1.1/1.2 ✅ (envelopes as tables, repeated element as rows, faults as errors), **SFTP** ✅ (password or key, host key pinning, files and folders as tables; FTP without TLS not offered); message queues (P2) not yet) |
| DS-10 | Connection via **Nexus Agent** for private networks (choose "Direct" or "Via Agent") | P1 | ✅ (Settings → Nexus Agents: create an agent (token shown once), download the single-file agent (Node 20+), list connections in its config with `${ENV}` secrets; each connection becomes a data source with no credentials in Nexus; test/scan/sample/pipeline reads and writes/live queries run through it; online status, version and host shown) |
| DS-11 | Source ownership + tags + environment (dev/staging/prod credentials per source) | P1 | ✅ (2026-10-17: every data source has an owner (the person who added it by default; changeable to any member) who also gets its health and schema-change alerts, and tags (lower case, up to 10); Data sources filters by text, tag and owner; in an environment group (GV-7) each source shows its counterpart in every other environment (same name and connector, as promotion maps them: set up and its connection state, a name clash with another connector, or missing) and "Add to <environment>" creates it there with the same connector, role, owner and tags but no credentials, which are entered in that environment; audited in both workspaces) |
| DS-12 | **Intranet APIs**: APIs that exist only inside a company network can be connected without DevOps opening inbound firewall ports, and the cloud never calls private addresses on request | P1 | ✅ (three ways, [guide](integrations/intranet-apis.md): **A. Nexus Agent**: a `rest` connection in the agent holds only the base URL and sign-in; the request (path, paging …) is designed in Nexus, sent with each task and merged by the agent, whose base URL and secrets always win, requests stay under the base URL, no redirects (agent 1.2.0); **B. Manual publishing**: the network team exposes the API through its gateway and admits only Nexus by client certificate (mTLS), signed requests (`X-Nexus-Signature`, HMAC-SHA256) and/or outbound IPs (`NEXUS_EGRESS_IPS`, shown when fixed); company CA supported; **C. Self-hosted**: `NEXUS_PRIVATE_NETWORK_ACCESS=true`. REST, SAP, Talenta and KMPlus product requests from the cloud refuse private/intranet addresses and every redirect target with a message pointing to the agent) |
| DS-13 | **Secrets managers as credential providers**: data source credentials reference secrets kept in the customer's secrets manager instead of storing passwords in Nexus | P1 | ✅ (HashiCorp Vault / HCP Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager, Doppler; references `{{secret:<manager>:<path>#<field>}}` resolved at connection time (tests, scans, samples, runs, live queries, Data API), cached ≤ 60 s in memory, never saved; secrets managers have no tables and never appear in pipelines, catalog or AI drafts; \"Use a secret\" picker lists names only; [guide](integrations/infrastructure-and-secrets.md)) |

**Acceptance (DS-1..4):** A user with a reachable MySQL DB can add it, see "Connected · 42 tables", open a table, and see 25 real rows in under 10 seconds.

### Layer 2 — Connector Marketplace (Phase 1) · 🟡

Pre-built connectors, installable in one click.

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| CM-1 | Catalog listing with category, version, description, free/premium badge, installed state | P0 | ✅ (search by name, system, format or Indonesian word, e.g. *HRIS*, *Excel*, *Active Directory*, *basis data*; grouped by Applications, KMPlus products, Databases & warehouses, APIs, Files, Identity & directories, with counts; search and category in the URL) |
| CM-2 | Install / uninstall; free connectors are pre-installed on account creation | P0 | ✅ |
| CM-3 | Premium connectors need a purchase (license) before install | P0 | 🟡 (dev mode: all connectors install free; set `CONNECTOR_BILLING_ENABLED=true` to require purchase; no real billing) |
| CM-4 | Connector detail page: docs, required permissions on the source system, supported operations (read / write / incremental / CDC) | P1 | ✅ (2026-10-17: `/dashboard/connectors/<slug>`: operations derived from the code (`lib/connectors/capabilities.ts`, engine-tested against the writers and the agent's connection types): read, write, incremental at the source or in Nexus, live queries pushed down or not, CDC (not yet), Nexus Agent, API steps; permissions to request on the other system and sign-in fields (EN/ID); install / uninstall; link to Help) |
| CM-5 | Connector versioning: upgrade notice, changelog, pinning per data source | P2 | ⬜ |
| CM-6 | Public Connector SDK (Phase 5) | P2 | ⬜ |

**Connector catalog (target) and current state**

| Category | Connectors | Built today |
|---|---|---|
| HR | SAP SuccessFactors, SAP HCM (OData), Oracle HCM, Workday, **Talenta (Mekari)**, Darwinbox, LinovHR | SAP (OData) ✅, Talenta ✅ (HMAC; verified against a mock gateway, not yet a live tenant) |
| ERP | SAP S/4HANA, Oracle EBS | SAP (OData) ✅ |
| CRM / SaaS | Salesforce | Salesforce (OAuth) ✅ premium |
| Identity | Azure AD / Entra ID (Graph), Active Directory (LDAP), OpenLDAP, Google Workspace Directory, Okta | Active Directory / LDAP ✅ (read-only: users, groups, OUs) |
| Productivity | Microsoft 365 / SharePoint (Graph), Google Sheets, Google Drive | ✅ 2026-10-17: SharePoint lists and document-library files (Graph, app registration), Google Sheets tabs, Google Drive folders (CSV/JSON/Excel, Sheets as CSV) through a service account; read-only; verified against local mocks |
| Databases | PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, MongoDB, Supabase | MySQL ✅, Oracle ✅, Supabase ✅, PostgreSQL ✅, **SQL Server / Azure SQL** ✅ (read-only: scan with primary keys and row counts, chunked reads in key order, incremental, live queries with pushdown; through the Nexus Agent for on-premises servers; not yet proven on a real server) |
| Warehouse | Snowflake, BigQuery | Snowflake ✅ premium |
| Storage / Files | AWS S3, Azure Blob, GCS, SFTP, CSV/Excel upload | CSV/Excel upload ✅ (parsed in the browser, stored in `nexus_raw`); **S3-compatible (S3, MinIO, R2, Wasabi, Spaces), Azure Blob, Google Cloud Storage** ✅ (CSV/TSV/JSON/NDJSON/XLSX files and `folder/*.csv` tables, read-only); **SFTP** ✅ (2026-10-17: password or key, host key pinning; same file tables) |
| Observability (Infrastructure) | Prometheus, Elasticsearch/OpenSearch, Elastic APM, Datadog, New Relic, Grafana, Dynatrace, Splunk | Prometheus ✅, Elasticsearch/OpenSearch ✅ (incremental on the watermark), Datadog ✅ premium, New Relic ✅ premium, Grafana ✅ (read-only; verified against local mocks) |
| Secrets managers | HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager, Doppler, CyberArk | Vault ✅, AWS ✅, Azure ✅, Google ✅, Doppler ✅ (credential providers, DS-13) |
| Generic | REST (Postman-style), GraphQL, SOAP, Webhook (inbound) | REST ✅, GraphQL ✅, SOAP ✅, inbound webhook / events ✅ (SC-6) |
| KMPlus products | KMS, LMS, TMS, PMS, CMS, IMS (first-class destinations) | ✅ destination connector over the [Nexus Ingest Contract](integrations/kmplus-ingest-contract.md) (each product implements 4 endpoints; verified against a reference mock); products can also pull via the Data API |

**Every connector must implement:** `test`, `scan`, `sample`. From Phase 1 it must also implement `read` (full + incremental), and `write` (insert/upsert) where the target supports it. See §14.3.

### Layer 3 — Data Mapping Studio (Phase 2; basic mapping pulled into Phase 1) · 🟡

Visual field mapping instead of SQL.

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| MP-1 | Two-pane mapper: source columns ↔ target (domain or destination) columns; drag-and-drop or dropdown | P0 | ✅ (2026-10-17: the Map step's dropdowns plus a **two-pane mapper**: input columns ↔ target fields, drag a column onto a target or onto “New field” (HR synonym names), targets loaded from a Unified Data Model entity or a defined dataset schema with auto-match, keyboard pick-and-use, transforms kept; `lib/pipelines/mapper.ts` pure and tested; defined datasets also map target-first in the Destination step) |
| MP-2 | Auto-map by exact/similar name (`EMP_ID` → `employee_code` via synonym list) | P0 | ✅ (auto-map with HRIS/ERP synonyms from the Unified Data Model, e.g. `PERNR` → `employee_code`) |
| MP-3 | Type conversion with explicit error behavior (fail row / null / default) | P0 | ✅ (failed conversions reject the row with a reason) |
| MP-4 | Built-in transforms: Trim, Upper, Lower, Title Case, Replace, Regex extract/replace, Date parse/format (with timezone), Number format, Concatenate, Split, Substring, Lookup (table), Null handling (coalesce), Default value, Conditional (IF/CASE), Hash (for masking) | P0 for the first 10, P1 rest | ✅ P0 (trim, case, replace, regex replace/extract, default, coalesce, prefix/suffix, substring, concatenate, split, date format with timezone, number format, round, to number/boolean, conditional, hash). Missing: lookup (P1) |
| MP-5 | Transform chaining per field (`Trim → Upper → Lookup`) | P0 | ✅ |
| MP-6 | Lookup tables: user-uploaded or dataset-backed (e.g., `ORG_CODE → org_name`) | P1 | ✅ (Map transform `lookup`: dataset, key column, value column, default; upload a lookup table with the CSV / Excel → Dataset template) |
| MP-7 | Nested objects / JSON flatten + build (for REST sources and destinations) | P1 | ✅ (2026-10-17: a Map source can be a path into a nested value (`address.city`, `phones.0.number`, `assignments[].org`; JSON text is read as its value); REST scans report objects and lists as JSON with the nested paths they saw, and the editor adds paths seen in the last test; **Flatten nested fields** adds one field per nested value; a target with dots (`address.city`) builds a nested object, stored as one json column; the **Split list** step gives one row per item of a list (item fields as columns, position column, empty lists kept or dropped, an item cap that flags the row); REST bodies and defined-schema bindings read paths too) |
| MP-8 | Relationship mapping (FK resolution: `MANAGER_ID` → `employee.id`) | P1 | ✅ (2026-10-17: Map transform **relationship** (`relate`): finds the reference in a dataset's key column and gives that record's id column, comparing ignoring case (and optionally leading zeros) or exactly; an empty reference stays empty; a reference not found quarantines the row (replayable once the related record exists), or is written empty and flagged, left empty, or kept; loaded once per run like lookup tables) |
| MP-9 | Live preview: apply the mapping to sample rows and show before/after | P0 | ✅ (Test on sample shows rows after every step) |
| MP-10 | Mappings saved as reusable **mapping templates** (e.g., "SAP PA0001 → Employee") | P1 | ✅ (built-in SAP HCM → Employee, Talenta → Employee, Active Directory → Users; workspace templates saved from any Map step) |
**Mapping must be stored as declarative JSON, not code.** That keeps it versionable, diffable, AI-generatable, and safe to run. See §12.2.

### Layer 4 — Pipeline Designer (Phase 1) · ✅

The visual workflow engine (inspired by NiFi, Power Automate, n8n, and Node-RED).

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| PD-1 | Canvas with nodes and edges (DAG); add, connect, configure, and delete nodes | P0 | ✅ (React Flow canvas: palette, drag/connect, router branches, multiple destinations; keyboard alternative to connect steps in the inspector) |
| PD-2 | Pipelines persisted to the DB with a versioned definition (`nodes`, `edges`, `settings`) | P0 | ✅ (`pipelines.config` = published, `draftConfig` = draft; every save is a `pipeline_versions` row; zod schema v2 `{nodes, edges, settings}` in `lib/pipelines/definition.ts`, v1 step lists still read) |
| PD-3 | **Real execution engine**: runs the DAG, streams batches between nodes, records per-node stats | P0 | ✅ (`lib/pipelines/engine.ts` runs the graph per 5,000-row chunk in the background worker; per-step stats) |
| PD-4 | Test run on a sample (N rows) with per-node output preview, no writes to destinations | P0 | ✅ |
| PD-5 | Validation before save: no cycles, every node configured, types compatible | P0 | ✅ (1–10 sources with one marked driver, ≥ 1 destination, reachable steps, no cycles, router branches, Join sides from different lanes, each lane ending in one place, upsert keys, soft-delete rules) |
| PD-6 | Write modes on Save: insert, upsert (on key), replace (truncate+load), soft-delete missing | P0 | ✅ (insert/append, upsert, replace via staging swap; soft-delete missing rows on full upsert runs: datasets `_nexus_deleted_at`, Postgres destinations a flag column) |
| PD-7 | Incremental sync using a watermark column, with a full-resync option | P0 | ✅ (SQL sources filter server-side; API sources filter after reading; Reset sync = full resync; one watermark per Source step, `pipelines.state.watermarks`) |
| PD-8 | Templates: "HRIS → Employee", "AD → Users", "CSV → Dataset", "Dataset → Power BI" | P1 | ✅ HRIS → Employee, AD → Users, CSV → Dataset ("New pipeline"); "Dataset → Power BI" is covered by the Data API, no dedicated template |
| PD-9 | Sub-pipelines / reusable components (call another pipeline as a node) | P2 | ⬜ |
| PD-10 | Per-pipeline settings: timeout, retries (count + backoff), concurrency (1 = no overlap), batch size, error threshold (abort if > X% rows fail) | P0 | ✅ (no overlap, retries 0–3 with doubling backoff, timeout, batch size, max-rows cap, quarantine-% threshold) |
**Node catalog**

| Node | Purpose | Phase |
|---|---|:-:|
| Source | Read from a data source object (full/incremental), or from a Nexus dataset | 1 |
| Filter | Keep rows that match conditions (uses the rule builder UI) | 1 |
| Map / Transform | Apply a mapping (Layer 3) | 1 |
| Validate | Apply data-quality rules; failing rows go to quarantine | 1 |
| Save / Destination | Write to a destination or Nexus dataset (insert/upsert/replace) | 1 |
| Notification | Email, Microsoft Teams, Slack, webhook (WhatsApp later) | 1 |
| Join | Inner/left/no-match join of two lanes on keys (right side staged) | 2 ✅ |
| Merge / Union | Combine streams with the same schema | 2 ✅ |
| Split / Router | Route rows to branches by condition | 2 |
| Decision | Branch the whole run (e.g., if row count = 0 → notify and stop) | 2 |
| Aggregate | Group by (+ time bucket) + count / count distinct / sum / avg / min / max / first / last / join / list, conditional measures | 2 ✅ |
| Deduplicate | Remove duplicates by key, keeping first/last/most recent; removed rows listed as flags | 2 ✅ |
| Lookup | Enrich from a dataset/lookup table | 2 |
| API Call | **Enrich** (read: per row or per batch, answer mapping, cache, call cap) and **API call (changes data)** (create / update with a call ledger and idempotency key) | 2 ✅ |
| SQL Query | Run a parameterized read-only query on a source | 2 |
| File Export | Write CSV/Excel/JSON/Parquet to storage or SFTP | 2 |
| Dashboard Refresh | Invalidate the cache for dependent dashboards/datasets | 3 |
| AI Processing | LLM classify/extract/summarize a field (with cost limits) | 4 |
| Approval | Pause the run until a human approves (e.g., before bulk deletes) | 3 |

### Layer 5 — Scheduling & Automation (Phase 1) · 🟡

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| SC-1 | Trigger types: Manual, Hourly, Daily, Weekly, Monthly, CRON, Webhook (signed URL), Event (another pipeline finished / dataset updated), API (`POST /api/v1/pipelines/:id/runs`) | P0 for manual/presets/cron; P1 webhook/API; P2 event | ✅ (manual, hourly, daily, weekly, monthly, cron; after another pipeline; webhook (secret URL); API `POST /api/v1/pipelines/:id/runs`) |
| SC-2 | Timezone per schedule (default **Asia/Jakarta**) with a human-readable preview ("Every weekday at 01:00 WIB"), plus the next 5 run times | P0 | ✅ (Asia/Jakarta, next 3 runs shown) |
| SC-3 | No overlapping runs by default; queue or skip policy | P0 | ✅ (skip; atomic claim per tick) |
| SC-4 | Pause/resume schedule; maintenance windows / blackout dates | P1 | ✅ (pause/resume; 2026-10-17: **maintenance windows** on the Pipelines screen (`maintenance_windows`, `lib/pipelines/maintenance.ts` pure): weekly hours (overnight allowed) or blackout dates in WIB, for every pipeline or some; scheduled and chained runs inside one wait until it ends (defer) or skip to the next scheduled time (skip); manual, webhook and API runs are not held; a notice shows while a window is active) |
| SC-5 | Pipeline chaining: run B after A succeeds | P1 | ✅ (schedule "After another pipeline": on success, success or partial, or any outcome; loops are rejected) |
| SC-6 | Event triggers from source systems (e.g., SAP event → run immediately) via inbound webhook | P1 | ✅ (inbound webhook per pipeline; 2026-10-17: **event adapters** on the same URL (`lib/pipelines/events.ts`, pure): CloudEvents 1.0 structured / batch / binary (SAP Event Mesh, S/4HANA, SuccessFactors, Event Grid CloudEvents schema) with the CloudEvents webhook handshake (OPTIONS), Azure Event Grid schema with subscription validation, Microsoft Graph change notifications with `validationToken` and a hashed `clientState`; **event-type filters** (prefix `*`), **de-duplication by event id** (`pipeline_trigger_events`, 7 days), and an event arriving during a run queues **one follow-up run** (`pipelines.eventPendingAt`); set in the editor → Schedule → Webhook trigger → Events from source systems) |
### Layer 6 — Monitoring Center (Phase 1) · ✅

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| MN-1 | Today's jobs summary: successful / running / failed / queued, plus a trend over 7/30 days | P0 | ✅ (today + 7-day trend, rows written/rejected 24h) |
| MN-2 | Pipeline health list: 🟢 Healthy · 🟡 Delayed (missed SLA / running long) · 🔴 Failed · ⚪ Paused | P0 | ✅ (+ rejected rows, never run; 7-day success rate) |
| MN-3 | Run detail: timeline per node, rows in/out/error per node, duration, logs, error message, stack trace (admin only) | P0 | ✅ (Pipelines → History: per-step counts and timings, per-destination writes, run log, error, attempts; stack trace for admins only) |
| MN-4 | Actions: Retry run, Retry from failed node, Replay quarantined rows, Cancel running, Download logs | P0 retry/cancel; P1 others | ✅ (Cancel, Retry; **Replay quarantined rows** from Data Quality; 2026-10-17: **continue a failed run from where it stopped** (its last checkpoint: finished chunks, passes and Join/blocking staging are kept 48 h after a read/write failure, `resumeRun` in `jobs.ts`) or run again from the start; **download the run log** as text from run details) |
| MN-5 | Alerts: on failure, on delay (SLA breach), on error rate > threshold; channels email/Teams/Slack/webhook; per-pipeline subscribers | P0 email; P1 others | ✅ (bell + email on failure or rejects; 2026-10-17: **alert channels** (Settings → Alert channels: Slack and Teams incoming webhooks as text / Adaptive Card, signed generic webhook; every pipeline or chosen ones; URL sealed, only its host shown), **per pipeline** (pipeline menu → Alerts: subscribers, channels, **error rate above N %**, **run longer than N min**, **no success for N h**; self-subscribe for any member); SLA checks from the cron tick (`pipeline_alerts.nextCheckAt`, each alert once); pure `lib/alerts/rules.ts`, sending `lib/alerts/send.ts`) |
| MN-6 | Root-cause hints: classify errors (auth, network, schema drift, validation, timeout, rate limit) with suggested fixes; AI-assisted in Phase 4 | P1 | ✅ (2026-10-17: rule-based classification of the run error (`lib/monitoring/root-cause.ts`: sign-in, permission, schema change, data type, timeout, network/TLS, rate limit, remote 5xx, offline agent, private network, held rows) with a fix and the screen to fix it on, in Monitoring, run history and failure alerts; AI-3 diagnosis for the rest) |
| MN-7 | Log retention: 30 days of detailed logs, 1 year of run summaries (configurable per plan) | P1 | ✅ (2026-10-17: per workspace in Settings → General: detailed logs 7 / 30 / 90 days (default 30: log lines and error stack removed, totals kept), run summaries 90 days / 1 / 2 years (default 1 year); pruned hourly by the scheduler (`lib/monitoring/log-retention.ts`); runs with open Data quality rows are kept; health check history 30 days; per-plan limits come with billing) |

### Layer 7 — Data Quality (Phase 2) · ✅ P0

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| DQ-1 | Rule types: required, unique, format (email/phone/NIK/NPWP), range, allowed values, referential (FK exists in dataset), date validity, cross-field (end ≥ start), custom expression | P0 | ✅ (Validate step: required, unique across chunks, email/phone/NIK/NPWP, regex, length, ranges, one-of, date, not in future, cross-field compare, exists in dataset, business-rule condition) |
| DQ-2 | Rule severity: **error** (quarantine the row), **warning** (pass + flag), **info** | P0 | ✅ (error → quarantine; warning/info → written and flagged) |
| DQ-3 | Quarantine store per run; steward UI to filter, edit inline, bulk-fix, approve, and **replay only fixed rows** | P0 | ✅ (Data Quality tab: inbox filters, inline fix, bulk fix, approve, dismiss, replay fixed/approved rows from the step that held them; up to 10,000 rows kept per run) |
| DQ-4 | Quality score per dataset (completeness, validity, uniqueness, freshness) with history | P1 | ✅ (daily snapshots after each run: completeness, uniqueness on keys, validity, score; freshness at view time; 30-day trend in the catalog) |
| DQ-5 | Built-in HR rule pack: Employee email exists, duplicate employee, missing organization, invalid position, invalid date, invalid/circular manager, missing required fields | P0 | ✅ ("Add HR rule pack" in Validate: required codes/names/emails, duplicate employee, valid email, org/position exist, unknown or circular managers checked over the whole run) |
### Layer 8 — Data Catalog (Phase 2) · ✅ P0

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| DC-1 | Auto-register datasets from schema scans (raw) and pipeline outputs (curated) | P0 | ✅ (every dataset and every scanned source table is listed automatically) |
| DC-2 | Search by name, description, column, tag, owner, source | P0 | ✅ (search across name, description, columns and their descriptions, #tags, owner, steward, source) |
| DC-3 | Dataset page: description, owner, steward, classification (Public / Internal / Confidential / **PII**), columns with business descriptions, freshness, row count, quality score, sample (masked by role) | P0 | ✅ (description, owner, steward, classification, tags, column descriptions, freshness, rows, quality score, sample masked and row-filtered by role) |
| DC-4 | **Lineage**: the source(s) → pipelines → dataset → consumers (dashboards, APIs, KMPlus apps) | P1 | ✅ (graph in the catalog: source tables → pipelines → datasets / written tables → dashboards, Data API entities, chained pipelines) |
| DC-7 | **Defined dataset schemas**: a dataset owns its columns (type, required, classification feeding Governance, keys); pipelines map onto it target first; several pipelines fill one dataset column by column; versioned, impact-previewed changes; renames kept for Data API clients | P1 | ✅ (2026-10-16, lanes phase D: define from current columns / a business entity / an example, or New dataset; partial upserts on the schema keys with column ownership shown; extra-column warning or auto-add with review; rename aliases for 30 days with Deprecation / Sunset / X-Nexus-Renamed-Fields; `dataset.schema_changed` webhook; promotion of schemas; opt-in upgrade banner) |
| DC-5 | Business glossary linking terms ("Active Employee") to datasets/columns | P2 | ⬜ |
| DC-6 | Request access workflow for restricted datasets | P2 | ⬜ |

### Layer 9 — Data Virtualization (Phase 3) · ✅ P0

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| DV-1 | Per-dataset access mode: **Live query** (pass-through to the source) or **Cached** (materialized copy in Nexus storage) | P0 | ✅ (per catalog source table; cached = a managed pipeline copying it into a dataset under its published name) |
| DV-2 | Cache refresh: 5 min, 15 min, hourly, daily, or on pipeline completion | P0 | ✅ (plus manual "Refresh now") |
| DV-3 | Live query guardrails: row limit, timeout, read-only, query pushdown where supported | P0 | ✅ (read-only transactions + statement timeout; equality filters pushed down for PostgreSQL, MySQL, file uploads; API connectors filter in Nexus) |
| DV-4 | Show freshness ("cached 12 min ago") everywhere the data is used | P0 | ✅ (catalog, dataset lists, Analytics widgets, Data API `meta.last_loaded_at` / `Last-Modified`) |

### Layer 10 — Dashboard Builder (Phase 3) · ✅ (DB-1 to DB-6 real)

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| DB-1 | Create a dashboard; add widgets (KPI, line, bar, pie, table, pivot) bound to catalog datasets | P0 | ✅ KPI, bar, line, table (no pie by design: bars compare better; no pivot yet) |
| DB-2 | Widget query builder: dimension, measure, aggregation, filters, time grain; no SQL | P0 | ✅ (live preview; SQL built from checked column names, values bound) |
| DB-3 | Combine datasets from different systems in one dashboard; cross-dataset joins via domain keys (e.g., `employee_code`) | P1 | ✅ (widgets from different datasets on one dashboard; 2026-10-17: a widget **joins a second dataset** on a key (keys suggested from domain fields: `employee_code` ↔ PERNR / NIP, `org_code` ↔ ORGEH, then same names), left or inner; the joined side gives one row per key (latest loaded) so totals never double; its columns (`join:<column>`, shown as dataset.column) work as measure, group by and filters; masks and row filters of both datasets apply; `buildWidgetSql` pure and tested) |
| DB-4 | Dashboard filters (date range, org unit) applied to all widgets | P1 | ✅ (2026-10-17: up to 4 per dashboard: date range (presets or custom dates) or one value (choices from the widgets' datasets with the viewer's masks and row filters); added as conditions to every widget whose dataset has the column, masked or missing columns skipped with a note; viewer's choice not saved; `applyDashboardFilters` pure and tested) |
| DB-5 | Share with roles/users; embed in KMPlus apps; export PDF/PNG | P1 | ✅ (2026-10-17: **Share**: the whole workspace or chosen roles and people (creator and admins always; `dashboards.sharing`, enforced in every dashboard action); **Embed** (admins): secret links `/embed/dashboards/nxe_…` (only a SHA-256 stored) that render read-only as viewer or analyst (masks and row filters apply), framed only by the listed https sites (CSP `frame-ancestors` from `proxy.ts`), with expiry, revoke, view counts, `?lang` / `?theme` / `?f.<filter>=` from the host app, rate-limited and audited; **Export PDF** (print view `/print/dashboards/<id>` with the current filters) and **PNG** per widget (drawn on a canvas from the result in the theme's colours); pure `lib/analytics/sharing.ts`) |
| DB-6 | Row-level security follows Governance policies | P0 | ✅ (masked columns unusable for restricted roles; row-level filters per role from the dataset policy) |
### Layer 11 — Business Rules Engine (Phase 2) · ✅

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| BR-1 | Visual IF/THEN builder: conditions (field, operator, value; AND/OR groups) → actions | P0 | ✅ (Business Rules tab; nested groups, THEN/OTHERWISE) |
| BR-2 | Actions: include/exclude row, set field value, calculate field, route to branch, notify, require approval, trigger pipeline | P0 | ✅ (calculations use the expression tree; approvals land in Data Quality) |
| BR-3 | Rules are reusable and referenced by ID from Filter/Validate/Router nodes | P0 | ✅ (plus a Business rules step; delete blocked while used; every save is a version) |
| BR-4 | Test a rule against sample rows | P1 | ✅ (latest dataset rows, masked, or typed JSON) |
| BR-5 | Rules stored as declarative JSON (same expression format as mapping conditions) | P0 | ✅ (`lib/rules/definition.ts`, shared condition/expression format) |

Example rules: `IF employment_status = 'Active' → Import`; `IF department = 'Finance' → Notify HR`.

### Layer 12 — AI Integration Assistant (Phase 4) · 🟡

| ID | Capability | Behavior |
|---|---|---|
| AI-1 | **Smart Mapping** | Upload CSV / pick a source table → AI proposes source→target mappings plus transforms with confidence scores. The user must accept them; they're never auto-applied. **✅ Map step → Suggest with AI** (to an entity's fields or clean names; reasons per field; ticked suggestions are added) |
| AI-2 | **Pipeline Recommendations / Generation** | "Sync active employees from Talenta to KMS daily" → a draft pipeline the user reviews **✅ New pipeline → Describe the pipeline** (the model fills a plan: template or copy, source, table, filter, schedule and a destination: a dataset, a database table, a REST API (body from a small example, read like a pasted one) or a KMPlus product; Nexus checks it against the real tables and destinations and builds it with the tested templates and body builders; the draft opens in the editor, nothing is saved or sent. Several sources, Aggregate and Enrich in drafts come later) |
| AI-3 | **Error Diagnosis** | Reads the run error + sample bad rows → explanation + a concrete fix ("Insert Date Formatter `dd/MM/yyyy` before Validate") with a one-click apply that creates a new draft version **✅ Run history → Diagnose with AI** on failed runs and runs that held rows (personal values redacted; fixes limited to add a Map transform, soften or remove a Validate rule — never identifier checks; applied as a new draft version, never published) |
| AI-4 | **Connector Suggestions** | Detects a system from a URL, file headers, or an error signature → recommends a connector **✅ Add data source → "Not sure which connector?"** (rules for URLs, error signatures and HR export headers answer first; the model only when they find nothing; pasted secrets scrubbed) and a hint under a failed connection test when the error looks like another system |
| AI-5 | **Natural-language catalog search** | "Where is training hours by department?" **✅ Catalog → Ask where data lives** (synonym ranking in English and Indonesian works without a model; a configured model re-ranks the shortlist and explains; only names, docs and columns are sent) |
| AI-6 | **Business rules from plain language** *(added)* | ✅ Rule editor → Describe the rule → a draft rule (conditions + actions) to review, test and save |
| AI-7 | **Ask your data** *(added)* | ✅ Analytics → Ask a question → the model writes a widget query (no SQL), Nexus runs it with the asker's masks and row filters; can be added to a dashboard |
| AI-8 | **MCP server for AI agents** *(added 2026-10-21, P2 proposed)* | ⬜ Not started. Nexus as a Model Context Protocol server, so customers' AI agents (Claude, ChatGPT, Copilot Studio, their own) can use governed data without exporting it. A thin layer over the Data API: one stateless Streamable HTTP endpoint with the same `nxk_…` keys, scopes, per-key rate limits and `handle()` checks; reads go through the Data API query builder with the key role's masks and row filters. **Phase 1 is read-only**, one tool per existing scope: `search_catalog` (names, docs and columns, never rows), `describe_dataset` (columns, classification, freshness, quality), `query_dataset` (filters and aggregates, with a row cap), `get_run_status` / `list_failed_runs` (with the root-cause hint). **Guardrails:** MCP keys read as `analyst` (masked) by default; unmasked (`steward`) only by an explicit admin choice with a warning that results go to the client's AI vendor (a personal-data transfer under UU PDP); small row caps, aggregates preferred; no write tools in phase 1, because returned values are untrusted text for a model (prompt injection); every tool call audited with key, tool and dataset. **Later:** `run_pipeline` behind `pipelines:run` with confirmation in the client; OAuth sign-in for clients that need it. **Not planned:** MCP as a pipeline source or destination (bulk, typed, paged movement stays with the connectors), or rebuilding the in-app assistant on MCP (its checked-plan design stays) |

**AI guardrails (added):**
- Send schema/metadata and *masked* sample rows only. Never send raw PII to the LLM unless the workspace opts in.
- All AI output becomes a **draft** that needs human acceptance, and acceptance is audited.
- Per-workspace AI usage limits and logging.
- Model: **open-source by default** (decided 2026-10-12, so it is free): any OpenAI-compatible server (Ollama, vLLM, LM Studio, llama.cpp; e.g. Qwen 2.5 7B, Llama 3.1 8B). Per workspace: the model configured for the Nexus server (`NEXUS_AI_*`), a model **next to a Nexus Agent** (prompts never leave the customer's network), or off. Since 2026-10-20 the server's model may instead be a **paid Claude model** (`NEXUS_AI_MODEL_TYPE=paid` with the separate `NEXUS_AI_PAID_*` settings); both setups stay configured and the type picks one. Settings → AI assistant warns that prompts then go to Anthropic. A model next to an agent is always open-source.
- Implemented: schema + a few example values of columns classified public (never personal/sensitive values); answers validated against the editors' schemas and real column lists with one repair round; every request audited (`AI_ASSIST`: feature, model; no prompt text).

### Layer 13 — Governance & Security (Phase 1 basics, Phase 2 full) · 🟡

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| GV-1 | **Workspaces (multi-tenancy)** with members and roles (§4 matrix) | P0 | ✅ (workspaces, switcher, members, link invites; roles admin/steward/operator/analyst/auditor/viewer) |
| GV-2 | RBAC enforced **server-side** in every server action / API route | P0 | ✅ (`requireWorkspace(permission)` in every action; matrix in `lib/auth/permissions.ts`; UI uses the same table) |
| GV-3 | Audit log for every create/update/delete/run/export/login/secret access, with actor, IP, user agent, and before/after diff | P0 | ✅ (changes, data views, runs, logins, 2FA events, policy changes, erasures; IP + user agent; **before/after values of changed fields** for pipelines (steps added/removed/changed, settings, schedule), data sources, rules, policies, catalog entries, roles and workspace names; secrets recorded only as "changed"; viewer in Settings) |
| GV-4 | Secrets management: envelope encryption (AES-256-GCM, per-workspace data key, master key from KMS/env), rotation, no secrets in logs | P0 | ✅ (AES-256-GCM envelope per workspace: data key derived from the master key with HKDF, bound to workspace and source; rotation via `reencrypt-credentials`; no KMS yet) |
| GV-5 | Data masking policies per column classification (full mask, partial `****1234`, hash), applied in preview, catalog, API, and dashboards by role | P1 | ✅ (Governance → Dataset policies; applied to previews, catalog, Analytics, Data API, quarantine and source samples) |
| GV-6 | Approval workflow for promoting pipelines to `prod` and for destructive write modes | P1 | ✅ (per-workspace policy: off / destructive changes (replace datasets, mark-deleted writes) / every publish incl. promotions; changes to defined dataset schemas follow the same policy (2026-10-17: renames, type changes and removals under destructive, every change but descriptions under every publish; applied as the requester's change, superseded when the schema moved past it); requests carry reasons and the diff against the running version; admins and data stewards approve or reject with a note, never their own; approvers notified in-app + email; needs two approvers to turn on) |
| GV-7 | Environment promotion dev → staging → prod, with per-environment source credentials | P1 | ✅ (environments are linked workspaces with their own members, data sources and credentials; Promote copies the published version, mapping data sources by name, business rules by name (created or updated) and chained pipelines by promotion key; preview shows blockers; Production starts locked (changes only by promotion); version deployed per environment shown on each pipeline) |
| GV-8 | SSO: SAML 2.0 / OIDC (Azure AD, Google, Okta) + SCIM user provisioning; MFA for password logins | P1 | ✅ (OIDC and SAML 2.0 with Microsoft Entra ID, Google Workspace, Okta or any provider; IdP metadata by XML or URL; DNS-verified domains; users join with a default role or only via SCIM; "require SSO" blocks passwords; mandatory TOTP for password logins; SCIM 2.0 Users + Groups at `/api/scim/v2` with group → role mapping, deactivation removes access and signs out everywhere. Real-IdP round trip not yet tested) |
| GV-9 | Row-level access policies (e.g., subsidiary A sees only its employees) | P2 | ✅ (row filters per role in the dataset policy, applied to previews, catalog, Analytics and the Data API) |
| GV-10 | Data retention policies per dataset; right-to-erasure support (UU PDP) | P2 | ✅ (retention enforced hourly; erasure across datasets, audited with a hash of the value) |

### Layer 14 — Version Control (Phase 1 basics) · ✅ P0

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| VC-1 | Every save of a pipeline/mapping/rule creates an immutable version (v1, v2, …) with author, timestamp, and a change note | P0 | ✅ (pipelines and business rules; author, time, change note) |
| VC-2 | Draft vs. published: schedules run only the *published* version; editing creates a draft | P0 | ✅ (Save draft / Save & publish; runs and schedules use the published version; discard draft) |
| VC-3 | Visual diff between versions (nodes added/removed/changed, mapping changes) | P1 | ✅ (2026-10-17: History → Compare: any two versions, steps added / removed / changed with each changed setting, field mapping changes per Map step, connections, settings and schedule; pure `lib/pipelines/version-diff.ts`) |
| VC-4 | Rollback = publish an older version as a new version (history is never rewritten) | P0 | ✅ (pipelines: History → Versions → Restore & publish; rules: load an old version and save) |
| VC-5 | Export/import pipelines as JSON (for moving between workspaces/environments and templates) | P1 | ✅ (2026-10-17: Export JSON from a pipeline's menu (published version, else draft; data sources by name and type, business rules with their bodies, the "run after" pipeline, defined dataset schemas; never credentials or rows; audited `EXPORT`); Import on the Pipelines screen with a preview: data sources matched by name and type or chosen from those of the same type, rules matched by name or created, missing dataset schemas created, a missing "run after" pipeline becomes a manual schedule; arrives as an unpublished draft, schedule off; refused in locked environments; audited `IMPORT`) |

### Cross-cutting: Nexus Data API (added; required for the "platform" promise)

| ID | Requirement | Pri | Status |
|---|---|:-:|:-:|
| API-1 | Workspace API keys (scoped: read datasets, trigger pipelines), hashed at rest, revocable | P0 (Phase 3) | ✅ (Settings → Data API keys: `datasets:read`, `domains:read`; SHA-256 at rest, shown once, expiry, revoke; reads as analyst (masked) or steward) |
| API-2 | `GET /api/v1/datasets/:name` with filtering, pagination (cursor), field selection, `updated_since` | P0 | ✅ (`filter[field][op]`, `fields`, `limit` ≤ 1,000, `cursor`, `updated_since`; live catalog tables by published name; masking + row filters by key role; audited) |
| API-3 | `GET /api/v1/domains/:entity` for Unified Enterprise Data Model entities | P0 | ✅ (Catalog → "Publish as a business entity" maps dataset columns to canonical fields) |
| API-4 | `POST /api/v1/pipelines/:id/runs` (trigger) and `GET /api/v1/runs/:id` (status) | P1 | ✅ (`POST /api/v1/pipelines/:id/runs`, `GET /api/v1/pipelines/:id/runs`, `GET /api/v1/runs/:id`, `GET /api/v1/pipelines`; scopes `pipelines:run`, `runs:read`) |
| API-5 | Outbound webhooks: `dataset.updated`, `run.failed`, `run.succeeded` | P1 | ✅ (Settings → Webhooks: HMAC-SHA256 signed, retries 1 min / 5 min / 30 min / 2 h, delivery log, test button; HTTPS public hosts only) |
| API-6 | OpenAPI spec published; rate limits per key | P1 | ✅ (`/api/v1/openapi.json` (OpenAPI 3.1, incl. webhooks); per-key requests/minute with X-RateLimit headers and 429 + Retry-After) |
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

*Snapshot from the codebase as of 2026-10-15. Update this table whenever a feature moves from mock to real.*

| Layer / area | Status | What's real | What's mock / missing |
|---|:-:|---|---|
| Auth & workspaces | ✅ | **Terms and Conditions** (versioned, English + Bahasa Indonesia, Indonesian prevails; required checkbox on sign-up enforced by the server; approval screen `/accept-terms` at first sign-in for SSO/invited/existing accounts and again after each new version, before 2FA setup; every acceptance stored with version, method, language, IP and browser in `terms_acceptances`; public `/terms`; shown in Settings → Your account) · Better Auth email/password with email verification (SMTP), **forgot password** (`/forgot-password` → one-time 1-hour emailed link → `/reset-password`; same answer whether or not the account exists; 3 requests/min per IP; signs out every session; "password changed" email; audited as PASSWORD_RESET; 2FA still required) and **mandatory TOTP 2FA** (any authenticator app, 10 backup codes, "trust this device" 30 days); self-service new backup codes and re-enrollment; admin 2FA reset (plus `scripts/reset-2fa.mjs` break-glass); **single sign-on** per workspace over OIDC or **SAML 2.0** (Entra ID, Google Workspace, Okta, any provider; DNS-verified domain, auto-join with a default role, optional "require SSO"); **SCIM 2.0 provisioning** (Users, Groups → roles, deprovisioning signs people out); workspaces with roles, switcher, emailed invite links (an invitee without an account creates it from the link: email fixed and verified by the invite, terms on the form, then 2FA setup and automatic join; existing accounts sign in to join; SSO domains continue with SSO); personal workspace auto-created; Settings tab for members | Tested against a real IdP tenant |
| App shell & design system | ✅ | KM+ “mimic panel” design system ([DESIGN.md](../DESIGN.md)): KM+ teal/cyan/purple/gray tokens with state colours, IBM Plex Sans/Mono, light/dark/system per user (profile menu, cookie `nexus_theme`); one grouped navigation (drawer on phones) with a URL and page title per screen (`/dashboard/<section>`, `/dashboard/settings/<tab>`), role-based landing (stewards → Data quality), “Go to…” jump search (Ctrl K); shared Dialog/ConfirmDialog, Notice, EmptyState, DataTable, FlowLine/StateMark, Toast; official KM+ logo and icons; **English + Bahasa Indonesia** switchable (`lib/i18n`, cookie `nexus_lang`) across every screen, settings panel, dialog, auth page and email; check messages in quarantined rows shown in the reader's language (`lib/pipelines/check-messages.ts`); server action errors translated for the caller (`lib/i18n/server-errors.ts`, a test fails when a thrown message has no translation) | Audit diff text and Data API errors stay English |
| Guided tour & Help | ✅ | **Guide me** (top bar): a 16-step tour in workflow order (Home → Connect → Build → Operate → Govern → Analyze & administer) that opens each screen and spotlights the real control (`data-tour` markers), non-blocking, resumable after reload, Esc to end, falls back to the screen title when a control isn't there for the role; **Help & FAQ** (`/dashboard/help`): the full product guide in English and Bahasa Indonesia in two parts: 12 numbered chapters in workflow order with 63 numbered sections (incl. 3.10 Environments: Development, Staging, Production and promotion), then a separate FAQ of 32 questions in 7 topics; diagrams drawn in the mimic-panel style (workflow, agent architecture, pipeline anatomy, secret references, promotion path), a roles matrix generated from the permission table, search, two-part contents that follow the reading position with real screenshots of the demo workspace in both languages and themes (`scripts/capture-help-screens.mjs`) | Screenshots are refreshed by hand when screens change |
| Overview | ✅ | Workspace mimic panel: greeting, last-24-hours readout, every pipeline as a flow line (tripped first), "Needs you" queue (held rows, approvals, failed runs, disconnected sources, flags), next scheduled runs, setup checklist until done | — |
| Data Sources | ✅ | CRUD, rename, source/destination switch, re-test, **scheduled health checks with history and alerts (DS-7)**, **schema drift on every re-scan with the pipelines it reaches (DS-8)**, delete guarded by pipeline use (draft and published definitions); credentials encrypted per workspace with key ids and rotation; edit credentials for every connector (REST/Salesforce secrets masked); **file uploads** (CSV/TSV/XLSX parsed in the browser, types detected, replace/append, stored in `nexus_raw`); samples masked for restricted roles; **intranet APIs** (DS-12): REST through a Nexus Agent with the request designed in Nexus, or published by hand with client certificate / signed requests / company CA (REST **Network** tab); private addresses refused from the cloud; **owner, tags and environments (DS-11)**: owner (gets the source's alerts) and tags with filters, each source's counterpart in the other environments of its group, "Add to <environment>" without credentials | Database hosts on private addresses are not pre-checked (they time out from the cloud; use an agent); drift is found by scans (every 6 h at most), not by watching the source |
| Connector Marketplace | ✅ | 32 connectors (incl. File Upload, KMPlus Products, SQL Server, 8 infrastructure, 5 secrets managers, and SharePoint, Google Sheets, Google Drive, SFTP, GraphQL, SOAP) with search and 8 categories (Applications, KMPlus products, Databases & warehouses, APIs, Files, Infrastructure, Identity & directories, Secrets managers); install/uninstall (uninstall blocked while used); dev mode installs everything free | No billing (`CONNECTOR_BILLING_ENABLED`) |
| Connector drivers | ✅/🟡 | SAP (OData), Oracle, MySQL, SQL Server / Azure SQL (read-only), Postgres (TLS verify/require/disable + CA), REST, Salesforce (OAuth), Snowflake, Supabase, Talenta, AD/LDAP, **SharePoint (Graph), Google Sheets, Google Drive, SFTP, GraphQL, SOAP**: test / scan / sample / pipeline read; write-back for Postgres, MySQL, Supabase, KMPlus products and REST APIs. `scripts/connector-harness.ts` verifies REST (read and write), SAP, MySQL, Postgres, LDAP, Talenta, File upload, KMPlus product mock, the infrastructure / secrets-manager mocks and the productivity / SFTP / GraphQL / SOAP mocks | Oracle, Snowflake, Salesforce, Supabase, live Talenta and the six DS-9 connectors not yet tested against real accounts; the new connectors are not agent-capable yet |
| Pipeline Designer | ✅ | Canvas editor (React Flow) with Filter, Map, Validate, Business rules, Router (branches) and multiple Destinations; test on sample with per-step counts and rows; drafts vs published versions; run settings (retries, timeout, batch size, quarantine threshold); run history with per-destination writes, run log and admin stack traces; incremental sync; soft delete of missing rows; **several sources** (2026-10-16, lanes phase A): up to 10 Source steps (lanes) with one marked driver; **Join** (left / inner / no match, one or more key pairs, key normalization trim / ignore case / leading zeros, one row per match or the first by a column, rows without a partner kept / dropped / quarantined with a replayable `joinNoMatch` check, prefix for clashing columns) and **Union** (`_source` column, lanes streamed one after another); **Aggregate** (group by + time bucket day…year, count / count distinct / sum / average / min / max / first / last by a column / join as text / list, conditional measures; refuses incremental reads of its lanes) and **Deduplicate** (normalized key; keep most recent by a date column, first or last read; removed rows listed in Data quality as flags) as blocking steps; **Enrich** (2026-10-16, lanes phase C: read-only API calls per row or per batch with keys in a query parameter or a POST body list, answer values picked from a sample answer into typed columns, lists as one row per item / first / JSON, no match keep / drop / quarantine, other 4xx quarantined, 5xx/429 retried, cross-run cache of mapped values sealed with the workspace key (default 24 h, max 7 days, "not found" 1 h, cleared by expiry, "Clear cache" and right to erasure), identical requests sent once, 50,000 calls per run unless an admin raises it per data source; test calls and sample tests limited to 5 calls) and **API call (changes data)** (create request, optional update request when a known record's data changed, a call ledger per key so retries, resumed chunks and replays never create twice, an Idempotency-Key on every call, answer values continue down the lane, sample tests are dry runs, "Send one test call" confirmed, audited and recorded; always counts as destructive for publish approval); both run through Nexus Agent 1.4.0+ (`apiCall`) for intranet APIs; the blocking steps answered in a finish phase (rows staged per group, answered 1,000 groups per chunk; an Aggregate can also prepare a Join's looked-up side, e.g. allowances per employee); runs in phases: every Join's right side is staged first (`nexus_stage` tables, checkpointed per lane, ≤ 1,000,000 rows, dropped at the end, 48 h sweep), then the driver streams and looks up each chunk's keys; per-source watermarks; sample tests fetch the staged side for the sample's keys (SQL sources and files) or up to 5,000 rows; canvas ports for Join sides; lineage, flow lines ("HRIS + 2 more") and promotion cover every source; write to Nexus datasets or back into Postgres/MySQL/Supabase (destination role only); **REST API destinations** (2026-10-15): method + path template (`/employees/{{employee_id}}`) per step, body built from a pasted JSON / form-encoded / XML example whose values bind to columns, fixed values, expressions or run information (auto-matched with HR synonyms; no template language), one request per row or N rows per request, refused items read from the response and 4xx rows sent to the quarantine with a redacted reason, 408/429/5xx retried with Retry-After, 401/403 stop the run, optional idempotency key (run:chunk:batch), rate limit / concurrency / timeout with chunks sized to finish in one worker slice, dry-run preview and audited test request with sign-in masked, personal-data warning, intranet APIs through Nexus Agent 1.3.0+; destinations Nexus can't write to are listed greyed out | Enrich / Changes data: JSON answers only, no DELETE, REST destinations without the create/update pair yet; an Aggregate with no rows writes nothing (no zero row); survivorship across duplicates and rolling windows are later work; right and full outer joins, joins by condition or date range, and re-emitting rows when only a staged lane changed are later work; staged rows are kept as JSON with an indexed key (typed staging comes with Aggregate); up to 1M source rows per run; REST destinations: one endpoint per step, nested lists built by grouping rows (phase 2), delivery to APIs is at-least-once (use PUT/PATCH by key or the idempotency key) |
| Background worker | ✅ | Postgres job queue (`pipeline_jobs`, `FOR UPDATE SKIP LOCKED` leases); runs read the source in 5,000-row chunks and checkpoint after each, so runs continue across 300 s invocations; retries resume from the last checkpoint; dataset `replace` loads into a staging table swapped in at the end | Delivery is at-least-once (TD-17) |
| Scheduler | ✅ | Supabase pg_cron job `nexus-pipeline-tick` (every minute, only calls Vercel when a pipeline is due, a job waits, a retention check, a webhook retry or a credential upgrade is due) → `/api/cron/pipelines` (Bearer `CRON_SECRET`, secret in Supabase Vault); schedules, **runs after another pipeline**, **inbound webhook URL** per pipeline, Data API trigger, **maintenance windows / blackout dates (SC-4)**, **event triggers (SC-6: CloudEvents / SAP Event Mesh, Event Grid, Microsoft Graph)** | — |
| Monitoring | ✅ | Today's outcomes, 7-day chart, pipeline health (stalled jobs flagged), background runs with live progress and Cancel, recent runs with Retry and **root-cause hints (MN-6)**, **continue a failed run from its checkpoint and download its log (MN-4)**, produced datasets; notification bell; replays run as `replay` runs | — |
| Data Mapping | ✅ | Map & transform step inside pipelines (23 transforms incl. dataset **lookup** and **relationship** (MP-8: reference → related record's id, missing ones quarantined / flagged / empty / kept), auto-map with HR synonyms, type conversion); **nested JSON** (MP-7): sources as paths into nested values, Flatten nested fields, dotted targets build nested objects, **Split list** step; built-in SAP / Talenta / AD mapping templates and saved workspace templates; pipeline templates (HRIS → Employee, AD → Users, CSV → Dataset) | Relationship mapping resolves through a dataset only (a manager created in the same run resolves on replay, not in one pass); Split list handles one list per step (chain steps for lists inside lists) |
| Data Quality | ✅ | Validate step with severities and the HR rule pack (NIK/NPWP/phone, cross-field, exists-in-dataset, manager hierarchy); Data Quality tab: quarantine inbox (filter chips; failed checks first; failing fields highlighted), fix one row at a time with **Save & replay** (confirms the destination) and fix-and-next, bulk fix, approve & replay, dismiss with undo, replay through the published pipeline; quality score per pipeline; daily per-dataset completeness / uniqueness / validity with a 30-day trend; masked rows not editable | Custom quality rules per dataset outside pipelines |
| Data Catalog & Virtualization | ✅ | Every dataset and source table listed automatically; search; owner, steward, classification, tags, column descriptions; quality history and freshness; **lineage graph**; masked, row-filtered samples; source tables queried **live** (read-only, limit, timeout, pushdown) or **cached** by a managed pipeline (5 min … daily, after another pipeline, or manual); publish datasets as Unified Data Model entities; **defined dataset schemas** (2026-10-16, lanes phase D: define from current columns without reloading, from a business entity or a pasted example, or start a New dataset; types, required, classification synced into the dataset policy, key columns; changes as versions with impact previews (rows without a value, values that don't convert, the pipelines / dashboards / API keys using the dataset); renames move pipeline drafts, dashboard widgets and masks, published pipelines follow active aliases, and the Data API serves the old name for 30 days; target-first mapping in the Destination step with auto-match, required / conversion checks and the extra-column question at Test and Save; each pipeline writes only its mapped columns on the schema keys (the schema page shows who fills what, "last writer wins" flagged); "Add new columns automatically" with steward review before the Data API exposes them; schemas travel with promotion (additive only); opt-in upgrade banner on the Catalog and Overview) | Business glossary, access requests; destination bindings are column / fixed value / kept expressions (lookups go in a Map step); no blank-schema editor (start from an example) |
| Business Rules | ✅ | Rules tab: IF/THEN/OTHERWISE builder with nested AND/OR groups, set/calculate fields, route, notify, require approval, trigger pipeline; tester on dataset rows or JSON; versions; used by Filter, Validate, Router and Business rules steps | Rule templates |
| Analytics / Dashboards | ✅ | Dashboards of KPI, bar, line and table widgets over workspace datasets; no-SQL builder (measure, group by, time grain, filters, sort, limit, **a join to a second dataset on a domain key (DB-3)**) with live preview; masked columns blocked and row-level filters applied for restricted roles; soft-deleted rows excluded; data freshness per widget | — |
| Version Control | ✅ | Pipelines: draft vs published, every save a version, publish/discard/restore; business rules versioned; **JSON export / import (VC-5)**; **compare any two versions (VC-3)** | — |
| Governance | ✅ | Controls overview; dataset policies (classification, masking: hide / keep last 4 / pseudonymize; suggestions from column names; **row-level access per role**); retention (hourly); right to erasure; per-workspace credential keys; roles, permissions and audit log (Settings); **publish approvals** (GV-6) and **environments dev → staging → prod with promotion** (GV-7) | KMS |
| Email | ✅ | SMTP mailer (`lib/email.ts`, company mail server `mail.kmplus.co.id` as `noreply@kmplus.co.id`) for verification, invites, 2FA resets and alerts, in one branded KM+ layout (logo band, teal button, details table, plain-text twin) built in `lib/email-templates.ts` in the sender's language; set in every Vercel environment (2026-10-09) | Bounce/delivery tracking |
| AI Assistant | 🟡 | Open-source model (Ollama/vLLM… via OpenAI-compatible API) on the Nexus server or next to a Nexus Agent, or a paid Claude model on the server (`NEXUS_AI_MODEL_TYPE=paid`, both env sets side by side); mapping suggestions (AI-1), pipeline drafts from a description to any destination (AI-2), run error diagnosis with fixes applied as drafts (AI-3), connector suggestions (AI-4), natural-language catalog search (AI-5), rules from plain language (AI-6), questions answered as governed charts (AI-7); privacy guardrails and audit | Not yet run against a real model (backlog: Ollama + Qwen 2.5 3B/7B on test-data, tune prompts); usage limits |
| Data API | ✅ | `GET /api/v1/datasets`, `/datasets/:name` (fields, filters, cursor, `updated_since`, live catalog tables), `/domains/:entity`, `/pipelines`, `POST /pipelines/:id/runs`, `/runs/:id`; scoped, hashed, expiring, revocable keys with per-key rate limits (Settings); masking and row filters by key role; every read audited; OpenAPI 3.1 at `/api/v1/openapi.json`; outbound signed webhooks with retries | SDKs |
| MCP server | ⬜ | — | Not started: a read-only MCP endpoint over the Data API for customers' AI agents (AI-8: catalog search, dataset descriptions, governed queries, run status; masked by default; no write tools in phase 1) |

**Tech debt register** (reviewed 2026-10-09). Priority: **P1** before the first customer pilot · **P2** before GA · **P3** when convenient. Move items to *Resolved* when fixed.

| # | Area | Debt | Risk if left | Pri | Fix |
|---|---|---|---|:-:|---|
| TD-6 | Platform | **Dev database shares the production Postgres server** (`nexus_dev` database) because the free plan allows 2 projects per owner; dev and preview have no scheduler (the worker is nudged by page polls there). | Heavy dev load could slow production | P2 | Move dev to its own Supabase project when upgrading |
| TD-7 | Platform | **Vercel Hobby plan limits:** 300 s functions, daily-only Vercel cron (worked around with Supabase pg_cron). Hobby is for non-commercial use. | Customer use needs a paid plan | P1 before customers | Upgrade to Vercel Pro (and Supabase Pro for backups/PITR) |
| TD-10 | Connectors | **Not yet proven on real accounts:** Oracle, SQL Server, the infrastructure connectors and secrets managers (verified against local mocks that check Signature V4, Google JWTs, Entra ID, AppRole), Snowflake, Salesforce, Supabase (REST path) and live Talenta (response format not public). | First customer finds the bug | P1 for the connectors a pilot uses | Run the harness with real credentials (env vars already supported) |

| TD-26 | Platform | **Rate limits are fixed one-minute windows in Postgres.** Fine for current volume; adds one write per API request. | DB load at high API volume | P3 | Move counters to Redis / Upstash when traffic grows |

**Open owner action:** the production database password and the `noreply` mailbox password were shared in a chat transcript (2026-10-08/09). Rotate both with [docs/runbooks/rotate-secrets.md](runbooks/rotate-secrets.md) before customer data arrives.

**Resolved:** credentials encrypted at rest · UUID ids · zod validation on all actions · shared `requireWorkspace` · single pnpm lockfile · committed migrations + tracked runner · workspaces & server-side RBAC · CI (type-check, engine tests, build) · dev database separated from production data · 2026-10-09: TD-1 DB certificates verified (bundled Supabase root CA; Postgres sources get verify/require/disable + CA) · TD-2 email verification + mandatory TOTP 2FA · TD-3 key ids + `NEXUS_ENCRYPTION_KEY_PREVIOUS` + `scripts/reencrypt-credentials.mjs` · TD-4 / TD-18 SMTP via the company mail server (`noreply@kmplus.co.id`), emailed invites and alerts · TD-5 background worker with chunked, resumable runs · TD-8 type errors fail the build · TD-9 integration tests in CI (`scripts/integration-tests.ts`, Postgres service) · TD-11 REST/Salesforce credentials editable · TD-12 mock screens and nine mock tables removed · TD-13 stale scripts removed · TD-14 all timestamps `timestamptz` · TD-15 complete audit trail + viewer · TD-16 migration checksums: `db-migrate` refuses edited applied migrations · TD-19 2FA recovery (new backup codes, re-enroll, admin reset, break-glass script) · TD-20 Analytics and Governance are real · server-action errors reach users in production (returned as values, `lib/action-result.ts`) · source column types (numeric, date) carried into datasets · 2026-10-11: TD-21 masking now covers source samples, catalog live samples, quarantine rows and the Data API · TD-22 credentials re-sealed with per-workspace keys automatically by the scheduler tick · TD-23 Data API rate limits + OpenAPI spec · TD-17 exactly-once appends to Nexus datasets (rows carry run + chunk; a resumed chunk replaces its own earlier copy in the same transaction; external databases: use upsert keys) · 2026-10-12: TD-2 SAML 2.0 + SCIM provisioning · TD-24 a full run supersedes older quarantine rows (fixes and approvals carry over to the new copy) and replays into replace datasets replace rows by key · TD-25 SSO client secrets sealed with per-workspace keys (opened for Better Auth by a Kysely plugin; old rows sealed by the cron tick).

---

### Pipeline runtime notes (2026-10-11)
- "Run now" and the scheduler only queue a run (`pipeline_jobs`, one active job per pipeline). The worker (`lib/pipelines/jobs.ts`) runs in the cron route and, after "Run now", in the same function via `after()`; pages showing run progress restart it when a job is waiting.
- Sources are read in 5,000-row chunks in a stable order (watermark column, then primary key; `ctid` for tables without one). APIs without paging are read once per invocation and sliced. Each chunk is transformed, written and checkpointed; a slice stops ~75 s before the 300 s limit and the next invocation resumes.
- Transient failures retry from the last checkpoint with exponential backoff (`settings.retries`, `retryDelaySeconds`); configuration errors fail immediately. "Unique" validation spans chunks (hashed values in `pipeline_job_seen`).
- Writing into a customer database requires the data source to have been added with **Add Destination** (role `destination`) and the table must already exist; each chunk is written in its own transaction.
- Up to 10,000 quarantined/flagged rows per run are kept in `pipeline_run_rejects` (counts are always complete); source reads are capped by the Source step's *max rows* (≤ 1,000,000).
- Pipelines are graphs (`{nodes, edges, settings}`): each chunk flows through Filter / Map / Validate / Business rules / Router steps to one or more destinations. Runs and schedules use the **published** version; saving creates a draft.
- **Replay** (Data Quality) queues a run with trigger `replay`: the selected fixed or approved rows re-enter the published graph at the step that held them; nothing is read from the source and "replace" destinations are appended to.
- **Cached catalog tables** are managed pipelines named "Cache · <source> · <table>" that replace a dataset named after the table's published name.
- **Defined dataset schemas** (2026-10-16, lanes phase D, `lib/datasets/*`): `dataset_schemas` (one per dataset: columns, keys, auto-add, version) with `dataset_schema_versions`, `dataset_column_aliases` (renames, 30 days) and `upgrade_notice_dismissals`; `nexus_datasets.defined`. The worker's `writeOutputs` runs `prepareDefinedWrite` for a defined dataset: active aliases applied, extras auto-added (by name only), the mapping resolved and every row conformed (`conformRows`: missing required value or failed conversion → quarantine at the destination), then only the mapped columns are upserted on the schema keys. `changeSchema` alters the table in one transaction, writes a version, syncs the dataset policy, moves renames into pipeline drafts / dashboards / domain mappings, audits `SCHEMA_CHANGE` and emits `dataset.schema_changed`. The Data API maps aliases into the column list and masks and sends `Deprecation`, `Sunset` and `X-Nexus-Renamed-Fields`.
- **Several sources** (2026-10-16, `lib/pipelines/lanes.ts`, `stage.ts`): a run first stages each Join's right side (`progress.phase = 'stage'`, one pass per lane source with its own offset in `progress.stage`; rows land in `nexus_stage.stg_<run>_<join>` with their normalized key, a resumed chunk replaces its earlier copy), then streams the driver and any Union partners one after another (`progress.streamIndex`). Each chunk's Join keys are looked up with one indexed query. Staging is dropped when the run finishes; the cron tick drops any older than 48 h (`pipeline_stage_tables`). A replay that re-enters at or before a Join stages again first; rows held inside a lane that feeds a Join, or before an Aggregate / Deduplicate step, can't be replayed (run the pipeline again).
- **API calls in a lane** (2026-10-16, lanes phase C): Enrich and "Changes data" steps call `ctx.api` (`lib/pipelines/api-runtime.ts`): requests are planned and answers mapped purely (`lib/pipelines/api-calls.ts`), sent by `lib/connectors/rest/call.ts` (server) or the agent's `apiCall` op, which return the answers received before a failure so every successful "Changes data" call is in `api_call_ledger` before the chunk fails. Enrich answers are cached in `api_call_cache` (per pipeline step; only mapped values, sealed). Calls per run per step are counted in `progress.apiCalls` against the data source's `maxCallsPerRun`. The chunk size follows the slowest API pace.
- **Blocking steps** (2026-10-16, lanes phase B): a run is a list of passes (`planPasses` in `lanes.ts`: one per Source and one per Aggregate or Deduplicate-last/most-recent, ordered so lookups and blocking steps are complete before they are read). Rows reaching a blocking step are staged with their group key; its finish pass reads 1,000 groups per chunk in key order (`progress.passes[step].cursor`), answers them in code (`lib/pipelines/aggregate.ts`, so conditions match Filter exactly) and sends the result on. Deduplicate keeping the first row streams (keys kept in `pipeline_job_seen`).

## 11. Architecture

### 11.1 Current stack
| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS v4, shadcn/ui (`components/ui`), Base UI, lucide-react icons |
| Auth | Better Auth (email/password) on Postgres |
| Metadata DB | Supabase PostgreSQL (Tokyo, transaction pooler, RLS on all tables) via Drizzle ORM (`lib/db/schema.ts`), `pg` Pool |
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
- **ADR-1 Execution engine:** don't execute in server actions. Options: (a) Vercel Workflow / Queues + Fluid Compute functions for batches; (b) a separate Node worker service (e.g., on Fly/Railway/Azure Container Apps) with a Postgres-backed queue (pg-boss/Graphile Worker); (c) Temporal. **Recommendation:** (b) a Postgres-backed queue + Node worker, because it works the same on-prem, which government customers need. **Decided 2026-10-09 (TD-5):** the Postgres queue (`pipeline_jobs`, SKIP LOCKED leases, chunked checkpointed runs) runs inside the app's Vercel functions for now (cron tick + `after()`); the same `processJobs()` can later run in a standalone worker service or on-prem without changing the queue.
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

**Built (2026-10-12):** a single-file Node program (`agent/`, built to `public/downloads/nexus-agent.mjs`) that long-polls `/api/agent/v1/tasks` over HTTPS (Vercel functions can't hold WebSockets), runs test/scan/sample/readChunk/readRows/write/liveQuery/ai with Nexus's own driver code, and posts results (gzip). Tasks are a DB mailbox (`agent_tasks`), deleted once read. Credentials live only in the agent's config (`${ENV}` references). Marking missing rows deleted works through agents too (keys of not-yet-deleted rows are paged from the agent, the missing ones marked in batches; agent 1.1.0+). **Intranet APIs** (agent 1.2.0, DS-12): a `rest` connection holds the base URL and sign-in; tasks carry the request designed in Nexus (`request` in the payload), which the agent merges under its own fields (`lib/connectors/rest/agent-request.ts`); every task runs with private-network access (`withPrivateNetworkAccess` in `lib/net/safe-url.ts`), while the cloud server refuses private addresses. Not yet: auto-update, Windows installer.

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
Auth extras: `twoFactor`. Workspaces: `workspaces`, `workspace_members`, `workspace_invites`.
Product: `data_sources`, `connector_installs`, `pipelines` (published `config` + `draftConfig`), `pipeline_versions`, `pipeline_jobs`, `pipeline_job_seen`, `pipeline_job_pairs`, `pipeline_stage_tables`, `api_call_cache`, `api_call_ledger`, `execution_logs`, `pipeline_run_rejects` (quarantine), `nexus_datasets`, `business_rules`, `business_rule_versions`, `dataset_policies` (masking, retention, row filters), `catalog_entries`, `domain_mappings`, `api_keys`, `dashboards`, `notifications`, `audit_logs`.
Data schemas: `nexus_data` (datasets), `nexus_raw` (uploaded files), `nexus_stage` (run staging for Joins). All product tables are scoped by `workspaceId`.

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

The five-year scaling plan (targets, scale triggers, architecture stages, 2026–2031) is in [product-roadmap.md](product-roadmap.md).

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
- Bahasa Indonesia strings: add every new interface string to `lib/i18n/messages/en.ts` and `id.ts` (same shape, checked by the compiler and `engine-tests`) and read it with `useT()` / `usePrefs()`; avoid hardcoding long copy deep in components.

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
| Pipelines executed in serverless request handlers time out | High | Resolved 2026-10-09: job queue + chunked, resumable runs (ADR-1, TD-5) |
| Credential leak | Critical | Encrypted at rest since 2026-10-08; key rotation since 2026-10-09; KMS-held master key before GA |
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
