# KMPlus Nexus — Product Roadmap & Scaling Plan (2026–2031)

| | |
|---|---|
| **Horizon** | Q4 2026 → end of 2031 (five years from today) |
| **Owner** | Product (Nexus) |
| **Status** | Draft for review. Targets are planning assumptions, not commitments |
| **Last updated** | 2026-10-13 |
| **Review** | Every quarter against the scale triggers (§4); re-plan each year in Q4 |
| **Related** | [PRD.md](PRD.md) (what and why, §10 status, §13 phases, §15 pricing, §16 risks) |

**How to read this.** §1–2 say where Nexus is today and what limits it. §3 sets the five-year targets. §4 says *when* to scale each part (triggers, not dates). §5 is the year-by-year plan. §6–9 cover architecture, security, commercial and team scaling. §10 lists the decisions this plan depends on.

**Principle: scale by trigger, not by calendar.** Each upgrade in this plan has a measurable trigger (customers, runs per day, dataset size, a contract). We do the work when the trigger is close, not earlier. Nexus's job is to be cheap to run while it is small, and to never be the reason a deal is lost when it grows.

---

## 1. Where we are (October 2026)

Nexus works end to end for one region, one deployment model and pilot-sized workloads.

**Built and in production**
- Connect: 12 connectors (SAP OData, Oracle, MySQL, Postgres, REST, Salesforce, Snowflake, Supabase, Talenta, AD/LDAP, File Upload, KMPlus Products). 8 proven by the connector harness; Oracle, Snowflake, Salesforce, Supabase REST and live Talenta not yet proven on real accounts (TD-10).
- Transform & run: canvas pipelines (Filter, Map, Validate, Business rules, Router, multiple destinations), drafts and versions, background worker with chunked, resumable, exactly-once runs, schedules, chaining, webhooks, Data API triggers.
- Govern: data quality with quarantine, fix and replay; catalog with lineage; live and cached virtualization; masking and row-level access per role; retention and right to erasure; audit trail with diffs; approvals; dev → staging → prod environments.
- Distribute: Data API with scoped keys and OpenAPI, signed outbound webhooks, the Nexus Ingest Contract for KMPlus products, analytics dashboards.
- Identity & security: mandatory TOTP 2FA, OIDC and SAML SSO, SCIM, per-workspace credential keys with rotation.
- Reach: Nexus Agent for private networks; English and Bahasa Indonesia throughout; branded email.
- AI (open-source models only): mapping suggestions, pipeline drafts, run diagnosis, connector suggestions, catalog search, rules from text, questions as charts. Not yet run against a real model.

**What limits us today**

| Limit | Today | Breaks at roughly | Fix (see §6) |
|---|---|---|---|
| Hosting plan | Vercel Hobby (non-commercial use, 300 s functions) | First paying customer | Vercel Pro (TD-7) |
| Database plan | Supabase free, no point-in-time recovery | First customer data | Supabase Pro + PITR (TD-7) |
| Dev and prod on one Postgres server | `nexus_dev` next to `postgres` | Heavy testing or first load test | Own dev project (TD-6) |
| Region | Tokyo only | First customer that requires data in Indonesia | Indonesian-region option or self-hosted (§5, 2027–2028) |
| Worker | Runs inside web functions (cron tick + `after()`) | ~10k runs/day or long CPU-heavy runs | Standalone worker service on the same queue |
| Curated data | Datasets in the same Postgres as metadata | Datasets of ~10M+ rows, or heavy analytics | Separate data store, then warehouse destinations |
| Run size | ≤ 1M source rows per run | First large SAP history load | Higher caps after worker split; bulk paths |
| Rate limits | One-minute counters in Postgres | High Data API traffic (TD-26) | Redis-style counters |
| Billing | None (`CONNECTOR_BILLING_ENABLED` off; CM-3 in backlog) | First standalone sale | Decide pricing metric, then build CM-3 |
| Operations | One owner + AI-assisted development; no on-call | First SLA | Team and on-call (§9) |
| Open owner action | DB and mailbox passwords were shared in chat | Before any customer data | Rotate ([runbook](runbooks/rotate-secrets.md)) |

---

## 2. Where we want to be in 2031

**Vision.** Nexus is the data backbone of every KMPlus product and the default way Indonesian and Southeast Asian enterprises move HR, ERP and identity data between systems. Integration is a recurring product line, not a project cost.

**What stays true for five years** (from PRD §3 non-goals)
- HR-first, then ERP and identity. Not a Zapier-style consumer iPaaS.
- Not a full data warehouse: Nexus caches, governs and serves data, and writes to the customer's warehouse.
- Minute-level latency is the target. Sub-second streaming is re-evaluated in 2030, not promised.
- AI runs on open-source models (server, agent or customer-hosted), never paid model APIs, and its output is a draft a person reviews.
- Governance is never an add-on: masking, row access, audit and approvals apply on every new surface.

---

## 3. Five-year targets

Planning assumptions to size the work, reset at every annual review. Revenue and budget targets are set with finance and kept out of this document.

| Metric | Q4 2026 | 2027 | 2028 | 2029 | 2030 | 2031 |
|---|---:|---:|---:|---:|---:|---:|
| Paying standalone customers | 0 (1 pilot) | 5 | 15 | 35 | 60 | 100 |
| KMPlus product customers fed by Nexus | 0 | 10 | 40 | 80 | 120 | 150 |
| KMPlus products on Nexus (of 6) | 0 | 2 (KMS, LMS) | 6 | 6 | 6 | 6 |
| Active workspaces | ~10 | 50 | 200 | 500 | 1,000 | 2,000 |
| Published pipelines | ~50 | 500 | 2,500 | 7,500 | 15,000 | 30,000 |
| Runs per day | ~500 | 10k | 50k | 150k | 300k | 500k |
| Rows synced per month | ~10M | 250M | 1B | 5B | 10B | 25B |
| Largest dataset served | 1M | 10M | 50M | 200M* | 500M* | 1B* |
| Production-grade connectors | 8 proven / 12 | 20 | 35 | 60 (incl. partner) | 90 | 120 |
| Availability SLO (control plane) | none | 99.5% | 99.5% | 99.9% | 99.9% | 99.95% |
| Deployment models | SaaS (Tokyo) + Agent | + Pro plans, Indonesian region | + self-hosted | + SEA regions | + dedicated cells | all |
| Mean time to detect a failed run | minutes | < 5 min | < 5 min | < 2 min | < 2 min | < 1 min |
| Time to first successful sync (new customer) | days | < 1 day | < 4 hours | < 1 hour | < 1 hour | < 30 min |
| AI mapping suggestions accepted unedited | untested | ≥ 60% | ≥ 70% | ≥ 75% | ≥ 80% | ≥ 85% |

\* Above ~50M rows, the dataset lives in the customer's warehouse or a Nexus-managed analytical store (§6); Nexus keeps the catalog, lineage, policies and API.

---

## 4. Scale triggers

Each row is a promise: when the trigger is close, start the work so it lands before the trigger is hit.

| Trigger | Start when | Action |
|---|---|---|
| First customer data | Before the first pilot loads real data | Rotate shared secrets; Vercel Pro + Supabase Pro with PITR; own dev project (TD-6, TD-7); restore drill |
| First pilot connector chosen | Pilot signed | Prove that connector on the customer's real account (TD-10) |
| First standalone sale | Proposal stage | Decide the pricing metric (PRD §16 Q3); build connector billing (CM-3, today in backlog) |
| ~5,000 runs/day or runs > 30 min of CPU | Monitoring shows it | Move the worker to a standalone service pulling the same `pipeline_jobs` queue (ADR-1 option b) |
| Any dataset > 10M rows or analytics p95 > 3 s | Catalog / analytics metrics | Move curated datasets to a separate data store; add warehouse destinations |
| Data API > ~300 requests/s or rate-limit writes visible in DB load | API metrics | Rate limits on Redis-compatible store (TD-26); read replica for API reads |
| Customer requires data in Indonesia | Contract or RFP | Indonesian-region deployment (confirm provider availability) or self-hosted package |
| Government / bank requires on-prem | RFP | Self-hosted control plane package (Docker Compose → Helm) |
| First SLA in a contract | Contract | On-call rotation, status page, incident runbooks, error budget |
| > 100 workspaces or one tenant > 20% of load | Tenant metrics | Per-tenant quotas and fair scheduling; dedicated cell option for Enterprise |
| `audit_logs` / `execution_logs` > ~50M rows | DB size | Monthly partitions; archive to object storage per retention plan |
| Third-party wants to build a connector | First partner request | Publish the Connector SDK (Phase 5) |
| AI used weekly by > 30% of workspaces | AI audit counts | Usage limits per plan; model hosting capacity plan |

---

## 5. Year by year

### Q4 2026 — Pilot ready
*Theme: make what exists safe to sell.*

- **Security:** rotate the production DB and mailbox passwords; KMS-held master key plan; first external penetration test booked.
- **Platform:** Vercel Pro + Supabase Pro with PITR; separate dev project; backup restore drill documented in `docs/runbooks/`.
- **Connectors:** prove the pilot's connectors on real accounts (TD-10); run the harness in CI with real credentials held as secrets.
- **AI:** first run on a real open-source model (Ollama + Qwen 2.5 3B/7B on `test-data/`), tune prompts, measure the mapping acceptance rate.
- **Product:** Phase 1 exit criteria on a real SAP or MySQL source; first pilot with ≥ 5 production pipelines (Phase 2 exit).
- **KMPlus:** KMS or LMS consumes Employee/Organization through the Ingest Contract or Data API in one deployment (Phase 3 exit).
- **Stays in backlog:** connector billing (CM-3), until the pricing metric is decided.

**Exit:** a pilot customer runs production syncs on a paid, backed-up stack with rotated secrets and an agreed support process.

### 2027 — General availability
*Theme: from one pilot to a repeatable product.*

- **Commercial:** pricing metric decided; plans from PRD §15 enforced in code; connector billing (CM-3) and usage metering; self-service trial workspace.
- **Execution:** standalone worker service on the same queue (no queue change); per-workspace concurrency limits; run caps raised above 1M rows; bulk load paths for Postgres/MySQL (`COPY` / batched upserts).
- **Data:** curated datasets moved to their own database or cluster (metadata stays small and fast); read replica for API and analytics reads.
- **Connectors (→ 20):** local HRIS first (Mekari Talenta live, LinovHR, Gadjian, Darwinbox), then SAP SuccessFactors, Workday, Microsoft Entra ID / Graph, Google Workspace, SFTP, SharePoint/OneDrive files, BigQuery and Microsoft Fabric as destinations.
- **Pipelines:** Join, Aggregate and Deduplicate nodes; nested JSON flatten; diff view and JSON export/import of versions.
- **Agent:** auto-update, signed releases, Windows service installer, Docker image; agent health in Monitoring.
- **Operations:** structured logs and metrics per workspace/pipeline/run; error tracking; status page; on-call; 99.5% SLO with an error budget.
- **Compliance:** UU PDP controls documented (consent records, breach notification runbook, DPIA template); ISO 27001 gap assessment.
- **Region:** Indonesian-region deployment if a contract requires it (otherwise planned for 2028).
- **KMPlus:** KMS and LMS consume Nexus by default for new customers.

**Exit:** 5 paying standalone customers, 10 KMPlus customers fed by Nexus, 10k runs/day, 99.5% met for two quarters.

### 2028 — Enterprise & self-hosted
*Theme: win the customers who cannot use shared SaaS.*

- **Deployment:** self-hosted package (control plane + worker + Postgres) for government and banking, with offline licence keys and the same release train as SaaS; Indonesian region in production.
- **Data model:** Unified Data Model golden records: match and merge across sources (Employee, Organization, Position), survivorship rules, steward review queue in Data Quality.
- **Holdings:** group workspaces that consolidate subsidiaries with per-subsidiary masking and row access.
- **Change data capture:** minute-level CDC for Postgres (logical replication) and MySQL (binlog), through the Agent where needed.
- **Tenancy:** per-tenant quotas and fair scheduling; dedicated database option for Enterprise.
- **Governance:** business glossary, access requests with approval, data contracts on published entities.
- **Compliance:** ISO 27001 certification; annual penetration test; customer-held keys option (BYOK) for Enterprise.
- **KMPlus:** all six products (KMS, LMS, TMS, PMS, CMS, IMS) consume Nexus domains; product-specific connectors retired.

**Exit:** 15 standalone customers, ≥ 1 self-hosted government or bank customer, all KMPlus products on Nexus.

### 2029 — Ecosystem
*Theme: other people build on Nexus (PRD Phase 5).*

- **Connector SDK** (public, versioned, with contract tests) and a **marketplace** for partner connectors and templates, with review, signing and revenue share.
- **Templates gallery:** pipelines, mappings and rule packs per industry (manufacturing, mining, banking, public sector).
- **Sandboxed Script node** (the one custom-code step the PRD allows in Phase 5): isolated runtime, time and memory limits, no network unless granted.
- **Partner program:** certified implementers, partner workspaces that manage several customers.
- **Regions:** Southeast Asia expansion (Malaysia, Singapore, Philippines, Vietnam) with local data-protection controls and regional cells; UI languages added per market.
- **Reliability:** 99.9% SLO; multi-zone database; tested regional failover for SaaS.

**Exit:** 35 standalone customers, ≥ 60 connectors including partner-built ones, first partner revenue.

### 2030 — Intelligent operations
*Theme: Nexus runs itself, with people approving.*

- **AI operators:** diagnosis that proposes and, after approval, applies fixes; schema-drift detection with suggested mapping updates; anomaly detection on row counts and quality trends.
- **Models:** open-source models tuned on anonymized pipeline metadata (never customer rows); customer-hosted models through the Agent as standard for regulated customers.
- **Semantic layer:** governed metrics over Unified Data Model entities, served to the Data API, dashboards and BI tools.
- **Streaming review:** decide whether sub-minute event streaming is worth adding (today a non-goal), based on customer demand.
- **Cells:** cell-based architecture (a cell = control plane slice + workers + databases) so large tenants and regions scale independently.

**Exit:** 60 standalone customers, ≥ 80% of mapping suggestions accepted unedited, failed runs detected in < 2 minutes.

### 2031 — Platform company
*Theme: Nexus is how KMPlus and its partners deliver integration.*

- Every KMPlus implementation starts in Nexus; integration delivery time measured in hours.
- 100 standalone customers, 150 KMPlus customers fed by Nexus, 120 production-grade connectors.
- 99.95% control-plane SLO in SaaS regions; self-hosted and SaaS on one release train.
- Marketplace and partner channel are a meaningful share of new connectors and customers.

---

## 6. Architecture evolution

The building blocks were chosen so each stage reuses the last one: the Postgres job queue (ADR-1), the JSON pipeline definition (ADR-2), the JSON expression AST (ADR-3) and the Agent protocol stay the same; what changes is where they run.

| | **A. Today** | **B. 2027** | **C. 2028** | **D. 2029–2031** |
|---|---|---|---|---|
| Control plane | Next.js on Vercel Hobby | Vercel Pro | Vercel (SaaS) + container image (self-hosted) | Cells per region / large tenant |
| Execution | Postgres queue, worker inside web functions | Standalone worker service on the same queue; autoscaled | Per-tenant quotas, fair scheduling, CDC readers | Workers per cell; evaluate a workflow engine (e.g. Temporal) only if the queue limits us |
| Metadata DB | Supabase free, Tokyo, dev on same server | Supabase Pro + PITR, own dev project, read replica | Indonesian region; partitioned logs; dedicated DB option | Multi-zone, regional failover, per-cell databases |
| Curated data | `nexus_data` schema next to metadata | Separate database/cluster | + warehouse destinations (BigQuery, Snowflake, Fabric) as the large-data path | Managed analytical store option for customers without a warehouse |
| Files | `nexus_raw` tables | Object storage for uploads and archives | Same | Same |
| Rate limits / cache | Postgres counters | Redis-compatible store | Same | Same, per cell |
| Private networks | Agent (long-poll HTTPS) | Agent with auto-update and installers | Agent + CDC | Agent fleet management |
| AI | Open-source model on server or agent | Model hosting plan for SaaS; limits per plan | Customer-hosted models standard for regulated tenants | Tuned open-source models on anonymized metadata |
| Deployment | SaaS | SaaS | SaaS + self-hosted | SaaS cells + self-hosted + dedicated |

**Data growth hot spots to watch** (in order of what grows fastest): `execution_logs` and run logs, `audit_logs`, `pipeline_run_rejects`, `pipeline_job_seen`, dataset tables. Partition logs by month in Stage B; move archives to object storage according to each plan's log retention (PRD §15: 30 days Professional, 1 year Enterprise).

**Performance budgets to keep** (PRD §9): UI p95 < 200 ms, schema scan < 15 s for 500 tables, sample < 5 s, ≥ 10k rows/s for simple DB→DB mapping per worker. Every stage is load-tested against these before it ships.

---

## 7. Security & compliance track

| Year | Milestones |
|---|---|
| Q4 2026 | Rotate shared secrets; paid plans with backups; restore drill; first external penetration test booked |
| 2027 | KMS-held master key; UU PDP control set (consent, breach notification, DPIA); ISO 27001 gap assessment; dependency and secret scanning in CI; vulnerability disclosure policy |
| 2028 | ISO 27001 certification; BYOK for Enterprise; self-hosted hardening guide; annual penetration test |
| 2029 | SOC 2 Type II if regional customers ask for it; regional data-protection controls (Malaysia PDPA, Singapore PDPA, Philippines DPA) |
| 2030–2031 | Continuous control monitoring; customer-facing trust centre; certification renewals |

Rules that never change: credentials never leave the server or agent, every read of real data is audited, masking and row access apply on every surface, AI prompts never carry personal values.

---

## 8. Commercial scaling

- **Pricing metric:** decide by the first standalone proposal (PRD §16 Q3). Options: pipelines, active data sources, rows synced per month, or employee headcount. Recommendation to test with sales: **headcount bands for the HR domain** (familiar to HR buyers, predictable) **plus rows per month above a plan allowance** (fair for ERP-scale customers).
- **Billing (CM-3):** in backlog today; built in 2027 once the metric is decided. Until then every connector installs free (`CONNECTOR_BILLING_ENABLED` off).
- **Packaging:** Embedded / Professional / Enterprise / Government-on-prem as in PRD §15; Enterprise adds dedicated cells (2030).
- **Channels:** direct and KMPlus product upsell (2027); certified implementers (2028); marketplace and partners (2029+).
- **Unit economics to track from 2027:** infrastructure cost per workspace and per million rows, support hours per customer, time to first sync, gross margin per plan.

---

## 9. Team & operating model

Indicative roles per stage; headcount is set with finance.

| Stage | Who is needed | How we work |
|---|---|---|
| Q4 2026 (pilot) | Product owner/engineer, implementation lead for the pilot | AI-assisted development; CI checks on every push; owner handles incidents |
| 2027 (GA) | + platform/SRE engineer, connector engineer, customer success | On-call rotation, status page, incident reviews, quarterly roadmap review |
| 2028 (enterprise) | + security/compliance lead, second connector engineer, solutions architects for self-hosted | ISO 27001 processes; release train shared by SaaS and self-hosted |
| 2029+ (ecosystem) | + developer relations for the SDK, partner manager, regional support | Partner certification; marketplace review; regional on-call |

---

## 10. Decisions this plan depends on

| # | Decision | Needed by | Default if undecided |
|---|---|---|---|
| D1 | Pricing metric (PRD §16 Q3) | First standalone proposal | Headcount bands + rows above allowance |
| D2 | SaaS-first or self-hosted in v1 (PRD §16 Q1) | First government RFP | SaaS first; self-hosted in 2028 |
| D3 | Long-term home of curated data (PRD §16 Q2) | Any dataset > 10M rows | Separate Nexus database now; customer warehouse for large data |
| D4 | First KMPlus product on Nexus and its owner (PRD §16 Q4) | Q4 2026 | KMS |
| D5 | Indonesian-region provider | First residency requirement | Self-hosted package until a SaaS region is available |
| D6 | Model hosting for SaaS AI (open-source only) | AI weekly use > 30% of workspaces | Customer- or agent-hosted models; server model for small workspaces |
| D7 | Notification channels beyond email, e.g. WhatsApp (PRD §16 Q7) | 2027 GA | Email + in-app; webhooks for the rest |

---

## 11. Risks to this plan

| Risk | Signal | Response |
|---|---|---|
| Growth outpaces the single-owner operating model | Incidents or support load delay roadmap work | Hire platform/SRE and customer success before GA (§9) |
| One large tenant dominates load | One workspace > 20% of runs or rows | Quotas now; dedicated cell option |
| Local HRIS vendors change APIs | Harness failures on scheduled runs | Contract tests per connector; versioned connectors; vendor partnerships |
| Data residency blocks SaaS deals | Lost RFPs citing location | Pull the self-hosted package and Indonesian region forward |
| AI quality on small open-source models is too low | Acceptance rate under target | Rules-first paths stay the default (they work without a model); larger open models on customer hardware |
| Compliance certification slips | Enterprise deals stall in security review | Start ISO 27001 gap work in 2027 regardless of deal flow |

---

*Review this plan every quarter against §4 and update the targets in §3 each Q4. When a milestone ships, record it in PRD §10 as usual.*
