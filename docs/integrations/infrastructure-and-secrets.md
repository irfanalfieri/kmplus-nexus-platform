# Infrastructure sources and secrets managers

Two connector categories added in October 2026. They fit the Nexus flow differently:

| | **Infrastructure** | **Secrets managers** |
|---|---|---|
| What | Observability (APM, metrics, logs, alerts) and files in cloud storage | Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager, Doppler |
| Role in Nexus | **Data sources**: tables you browse, catalog, read in pipelines, query live | **Credential providers**: other data sources take passwords and keys from them |
| Pipelines / catalog | Yes (read-only sources) | Never: they have no tables, are hidden from the pipeline editor, catalog and AI drafts, and can't be sampled |
| Through a Nexus Agent | Yes (Prometheus, Elasticsearch, Grafana, MinIO usually sit inside the network) | No: Nexus reads them directly (cloud services, HCP Vault) |

---

## Infrastructure connectors

All are read-only and work like any other source: **Data sources → Add source → Test** scans the tables; pipelines read them; the catalog lists them; live queries work.

### Observability

| Connector | Tables | Notes |
|---|---|---|
| **Prometheus** (also Thanos, VictoriaMetrics, Grafana Mimir, Cortex) | `targets`, `alerts`, `rules`, `metrics` (name, type, help), plus one table per PromQL query | Queries: `name = query`, separated by `;;`, e.g. `api_latency_p95 = histogram_quantile(0.95, sum by (le, service) (rate(http_request_duration_seconds_bucket[5m])))`. Instant queries: one row per series (labels, value, timestamp). Bearer token or basic auth. |
| **Elasticsearch / OpenSearch** (incl. Elastic APM) | Every index and data stream matching the index pattern (e.g. `logs-*,traces-apm*`), columns from the mapping (dotted names) | Paged with the scroll API. **Incremental sync** on a date field (e.g. `@timestamp`) puts the watermark in the query, so each run reads only newer documents. API key or user/password; company CA supported. |
| **Datadog** | `monitors`, `slos`, `hosts`, `events`, `apm_services`, plus one table per metric query | API key + application key (read scopes); site (`datadoghq.com`, `datadoghq.eu`, `us3…`, `ap1…`); lookback window in hours. |
| **New Relic** | `apm_applications` (Apdex, error rate, response time, throughput), `alert_issues`, plus one table per NRQL query | User API key (`NRAK-…`) and account ID; region US or EU. |
| **Grafana** (self-hosted or Grafana Cloud) | `dashboards`, `folders`, `alert_rules`, `alerts` (firing), `annotations`, `datasources` (names and types only) | Service account token (Viewer). |

Good first pipelines: daily snapshots of `apm_applications` or a PromQL latency query into a dataset → an Analytics dashboard of service health next to HR data; Elasticsearch audit logs → quality checks → a dataset for compliance.

### Cloud file storage

| Connector | Sign-in |
|---|---|
| **S3-compatible**: Amazon S3, MinIO, Cloudflare R2, Wasabi, DigitalOcean Spaces, Backblaze B2 … | Access key + secret (Signature V4); empty for a public bucket. Custom endpoint for non-AWS storage (path-style URLs by default). |
| **Azure Blob Storage** (and ADLS Gen2 containers) | SAS token (read + list, preferred) or the account key. |
| **Google Cloud Storage** | Service account key (Storage Object Viewer); empty for a public bucket. |

Files under the bucket and folder become tables:

- every **CSV, TSV, JSON, NDJSON / JSON Lines and XLSX** file is a table named after its path (`daily/employees_2026-10-01.csv`);
- a folder holding **two or more files of one format** is also a table, e.g. `daily/*.csv`, which reads all of them in name order and adds a `_source_file` column, so daily exports with new names keep feeding the same pipeline;
- numbers and true/false values are typed like file uploads; Excel reads the first sheet;
- files over 200 MB are refused (split the export); scans read only the first 1 MB of CSV / NDJSON files.

A MinIO or other S3 inside the company network is reached through a Nexus Agent (`"type": "s3"` with `endpoint` in the agent config).

---

## Secrets managers

Instead of typing a database password into Nexus, keep it in your secrets manager and **reference** it:

```
{{secret:<secrets manager data source name>:<secret name or path>#<field>}}
```

- `#field` picks one field of a secret with several (Vault KV, JSON secrets in AWS / Google); a secret with one value or one field needs no `#field`.
- A reference can be a whole value or part of one: `postgres://nexus:{{secret:Vault prod:hr/postgres#password}}@db.company.local:5432/hr`.

### Set it up

1. **Connectors → Secrets managers**: install yours.
2. **Data sources → Add source**: pick it, fill in its sign-in, **Test** (lists how many secrets it can see), name it, e.g. `Vault prod`, and create it. It shows as **Secrets** under *Used as*.
3. In any other data source's credentials, next to a password field click **Use a secret**: choose the secrets manager, pick the secret (names are listed, never values), optionally a field, **Insert reference**. Or type the reference yourself.
4. **Test** the data source: Nexus reads the secret and connects.

| Secrets manager | Sign-in | Secret name |
|---|---|---|
| **HashiCorp Vault / HCP Vault** | Token, or AppRole (role ID + secret ID); namespace for Enterprise/HCP; KV mount and version (default `secret`, v2) | Path under the mount, e.g. `hr/postgres#password` |
| **AWS Secrets Manager** | IAM access key with `secretsmanager:GetSecretValue` and `ListSecrets` | Name or ARN; JSON secrets by field |
| **Azure Key Vault** | App registration (tenant, client ID, secret) with the *Key Vault Secrets User* role | Secret name, optionally `name/version` |
| **Google Secret Manager** | Service account key with *Secret Manager Secret Accessor* | Secret name, optionally `name/version` (default latest); JSON by field |
| **Doppler** | Service token (read-only, one project config) | Secret name, e.g. `HR_DB_PASSWORD` |

### What Nexus guarantees

- **Only the reference is saved.** Values are read when Nexus connects (tests, scans, samples, pipeline runs, live queries, Data API live tables), kept in memory for at most 60 seconds, and never written to the database, logs, audit entries, emails or the browser.
- **Rotation just works:** change the secret in your secrets manager; the next connection uses the new value (within a minute).
- **Workspace-scoped:** a reference can only name a secrets manager of the same workspace.
- **Secrets managers are never data:** no tables, not in the pipeline editor, catalog, AI pipeline drafts or Data API; a sample request is refused.
- Listing secret names (the picker) needs the *manage data sources* permission and is recorded in the audit log (count only).
- A secrets manager's own credentials may reference another secrets manager (one level), e.g. a Vault AppRole secret ID kept in AWS Secrets Manager.
- Agent-backed data sources keep their credentials in the agent's config, not in Nexus, so references don't apply to them; use the agent's `${ENV}` variables instead.

### Troubleshooting

| Message | Meaning |
|---|---|
| `No secrets manager named "…" in this workspace` | The name in the reference doesn't match a secrets-manager data source (names are case-sensitive). |
| `Could not read secret "…" in …: Secret … not found` | Wrong path / name, or the identity can't see it. |
| `Secret … has several fields (…); add #field to the reference.` | Name the field: `#password`. |
| `… rejected the credentials (HTTP 403)` | The secrets manager's own sign-in lacks read permission on that secret. |
