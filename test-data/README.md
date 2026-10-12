# KMPlus Nexus test data

Fictional HR data for two companies, **PT KMPlus (KMP)** and **PT KMPlus Inovasi (KMI)**, for trying every layer of Nexus end to end. All people, emails, NIKs and NPWPs are invented. The files contain **deliberate data-quality problems**; each scenario below says what you should see.

Regenerate the files (the output is identical on every run): `node scripts/generate-test-data.mjs`. The IDs of every problem row are in [`expected.json`](expected.json).

| File | Rows | What it is |
|---|---|---|
| `reference/organizations.csv` | 14 | Org units: `org_code` (5000xxxx), name, type, parent, cost center, company, head |
| `reference/positions.csv` | 44 | Positions: `position_code` (6000xxxx), title, job family/level, org, vacant (2 vacant) |
| `hris/employees_sap_pa0001.csv` | 152 | SAP HCM PA0001-style export for KMP: `PERNR`, `ENAME`, `USRID_LONG`, `GBDAT`/`BEGDA`/`ENDDA` (yyyyMMdd), `ORGEH`, `PLANS`, `MANAGER` … |
| `hris/karyawan_kmi.xlsx` | 90 | Local HRIS export for KMI, Indonesian headers (`NIP`, `Nama Lengkap`, `Email Kantor`, `No HP`, `NIK`, `NPWP`, `Tgl Lahir`, `Tgl Masuk`, `Kode Unit`, `Atasan`, `Gaji Pokok` …). Second sheet: `Unit Organisasi` |
| `learning/training_history.csv` | 400 | LMS training records (Completed 334, In Progress 41, Failed 25) |
| `identity/ad_users.csv` | 144 | Active Directory export: 139 people (10 disabled) and 5 service accounts |

## Planted problems

**SAP export (152 rows, 150 people)**: the HR rule pack should quarantine **8 rows** and flag **4**:

| Problem | Rows | Result |
|---|---|---|
| Invalid email (`budi.santoso@`, `rina.halim#…`, a space) | 00001061, 00001074, 00001032 | quarantined (error) |
| Missing name | 00001150 | quarantined |
| Same `PERNR` twice (second copy says "(DUPLIKAT)") | 00001047, 00001028 | second copy quarantined |
| `ENDDA` a year before `BEGDA` | 00001022 | quarantined (termination before hire) |
| `ORGEH` 59999999 doesn't exist | 00001131 | quarantined, **only if the organizations dataset exists first** |
| Hire date in 2027 | 00001128 | flagged (warning), still loaded |
| Manager 00009999 isn't an employee | 00001048 | flagged |
| Two people manage each other | 00001059, 00001105 | flagged (reporting cycle) |

Also in the file: 10 former employees (`STAT2` = 0 with a real `ENDDA`) and 16 contract staff among the loaded rows.

**KMI Excel (90 rows)**: **3 quarantined**, **5 flagged**:

| Problem | NIP | Result |
|---|---|---|
| Birth date `31/02/1990` | KMI-2077 | quarantined (not a date) |
| No office email | KMI-2087, KMI-2088 | quarantined (required) |
| NIK with 14 digits / day 99 / month 13 | KMI-2023, KMI-2061, KMI-2022 | flagged |
| Phone `021-5551234` (landline), `8123` | KMI-2020, KMI-2008 | flagged |

**Training history**: 5 records belong to people who don't exist (`00008001`, `00008002`, `KMI-9001`, `KMI-9002`, `EXT-0001`).

**AD export**: 10 employees have no account, 5 service accounts have no `employeeID`, 7 accounts have no mail, and one mail has a space in it.

---

## Scenarios

Work in a fresh workspace. Pipelines start from **Pipelines → New pipeline**: pick a template, the source and table, then **Build pipeline** opens the editor. Do the scenarios in order: later ones use datasets from earlier ones. Every pipeline run happens in the background, so watch **Monitoring** or the run history under the pipeline.

### 1. Upload the files (Data Sources)

1. **Data Sources → Add → File Upload.** Upload `reference/organizations.csv`, then add `reference/positions.csv`, `hris/employees_sap_pa0001.csv`, `learning/training_history.csv` and `identity/ad_users.csv` to the same source (one table each).
2. Upload `hris/karyawan_kmi.xlsx`; pick sheet **Karyawan** (header row 1). Optionally upload it again with sheet **Unit Organisasi**.

✅ Each table shows its row count and detected types: `PERNR` and `MANAGER` stay **text** (leading zeros), `BEGDA`/`GBDAT` are integers, and `Tgl Masuk` is a date. Opening a table shows a sample.

### 2. Reference datasets (CSV / Excel → Dataset)

**Pipelines → New pipeline → CSV / Excel → Dataset**, table `organizations`, dataset `organizations`. Run it. Repeat for `positions` (dataset `positions`).

✅ Datasets `organizations` (14 rows) and `positions` (44 rows) appear in **Data Catalog**. They must exist **before** scenario 3, because the HR rule pack only adds "exists in dataset" checks for datasets it can find.

### 3. SAP employees (HRIS → Employee + quality)

1. **New pipeline → HRIS → Employee**, table `employees_sap_pa0001`, dataset `employees`.
2. Open the **Map** step. Fields were mapped by synonym (PERNR → employee_code, ENAME → full_name, USRID_LONG → email, BEGDA → hire_date …). For nicer values choose **Apply template… → SAP HCM (PA0001 / PA0002) → Employee**: names become Title Case, `GESCH` becomes Male/Female, `STAT2` becomes Active/Inactive, and `ENDDA` 99991231 becomes empty.
3. Look at the **Validate** step: required fields, unique employee_code, email, NIK/phone warnings, dates, termination ≥ hire, `org_code` exists in `organizations`, `position_code` exists in `positions`, and the manager check.
4. **Test run** (top right) to preview on a sample, then **Publish** and **Run**.

✅ Run result: **152 read, 144 written, 8 quarantined, 4 flagged**. Dataset `employees` has 144 rows: 134 Active, 10 Inactive (with the SAP template applied).

### 4. Fix and replay (Data Quality)

1. **Data Quality → Quarantine** lists the 8 rows with their reasons and the 4 flags.
2. Edit 00001061's email to a valid one and mark it fixed. Do the same for the missing name (00001150).
3. **Replay** the fixed rows.

✅ The replay run writes 2 rows (dataset now 146). Rows you didn't fix stay quarantined. Dismiss the duplicates (00001047, 00001028): they are export glitches. The **quality score** for `employees` updates after each run (scenario 10).

### 5. KMI employees from Excel

**New pipeline → HRIS → Employee**, table `karyawan_kmi_karyawan` (or whatever the upload named it), dataset **`employees_kmi`**. Use a separate dataset: an HRIS → Employee pipeline marks rows missing from its source as deleted, so two sources in one dataset would delete each other's employees. Indonesian headers map automatically (NIP → employee_code, Nama Lengkap → full_name, Email Kantor → email, No HP → phone, NIK → national_id, Tgl Lahir → birth_date, Atasan → manager_code …).

✅ **90 read, 87 written, 3 quarantined, 5 flagged** (3 NIK, 2 phone).

To test **masking** in scenario 11, also load the whole sheet with **CSV / Excel → Dataset** into `karyawan_kmi_raw` (keeps NIK, NPWP, Gaji Pokok, Agama).

### 6. Business rule with approval (Business Rules)

1. **Business Rules → New rule**: "Contract staff need HR approval": when `employment_type` equals `Kontrak`, action **Hold for approval**.
2. In the `employees` pipeline add a **Rules** step after Validate using this rule. Publish and run.

✅ The 16 contract staff are held in the quarantine as **approval** (status open); the others load normally. Approve some in Data Quality and replay them: they load.

### 7. Lookup: department names on employees

In the `employees` pipeline Map step, add a field from `org_code` to `department` with the transform **lookup** (dataset `organizations`, key `org_code`, value `name`, default `Unknown`). Publish and run.

✅ Every employee gets a department name ("Finance", "Sales Jakarta" …). The run log says the lookup was loaded.

### 8. Router and chaining

- **Router**: add a router step after Validate with branches `employment_status = Inactive` → dataset `former_employees`, everything else → `employees`. ✅ `former_employees` gets 10 rows.
- **Chaining**: create a pipeline for `training_history` (CSV / Excel → Dataset, dataset `training_history`) with a Validate rule `employee_code` **exists in** `employees.employee_code`. Under Schedule choose **After another pipeline** → the SAP employees pipeline, "on success". Run the employees pipeline.

✅ When the employees run finishes, the training pipeline starts by itself (trigger `chain` in Monitoring). It loads the records whose `employee_code` is in `employees`. The 5 unknown trainees are quarantined, plus every record belonging to a KMI employee (`KMI-…`), because those live in `employees_kmi`. That makes a good discussion point for a unified model. A loop (A after B after A) is refused when saving.

### 9. KMPlus product destination (local only)

1. Add `NEXUS_ALLOW_PRIVATE_URLS=true` to `.env.local` and restart `pnpm dev`.
2. Start the mock product: `node scripts/run-ts.mjs scripts/mock-kmplus.ts` (port 4010, token `local-kmplus-token`).
3. **Connectors → KMPlus Products → install**, then **Data Sources → Add**: product `LMS`, base URL `http://127.0.0.1:4010`, the token above, role **destination**. **Test connection** shows "LMS (mock)" and entities `employee`, `organization`.
4. **New pipeline → HRIS → Employee** on the SAP table and choose this KMPlus destination too. Run it.

✅ The mock terminal prints the batches; the run writes 144 rows to the dataset **and** to the product. To see the destination quarantine, clear one employee's email in the Map step (a `default_if_empty` or `replace` transform): the product rejects records without an email, and they show up in Data Quality at the **destination** step.

### 10. Catalog, lineage and quality history (Data Catalog)

✅ `employees` shows its columns, owner/description you can edit, the **lineage graph** (File Upload source → pipelines → `employees` → `former_employees` / the training chain / the KMPlus product), and the **quality history** (completeness, uniqueness, validity, score) with one point per day it ran. Map `employees` to the Unified Data Model entity **Employee** here (needed for scenario 12's `/domains/employee`).

### 11. Governance: masking and row filters

1. **Governance → `karyawan_kmi_raw`**: Nexus suggests a policy from the column names: `nik`, `npwp`, `nama_lengkap`, `tgl_lahir` as *personal* (Pseudonymize), `email_kantor` and `no_hp` as *personal* (Keep last 4), `gaji_pokok` and `agama` as *sensitive* (Hide). Review and save it.
2. Add a row filter for role **analyst**: `kode_unit` equals `50000061`.
3. Invite a second account as **analyst** (Settings → Members) and look at the dataset with it.

✅ As admin (or data steward) you see real values. As analyst you see pseudonymized NIK/NPWP, `••••••` for salary and religion, phone numbers with only the last 4 characters, and only KMI Product rows. The same applies to Analytics and to the Data API with an analyst-role key.

### 12. Analytics

On `employees`: **headcount by department** (bar, count of employee_code by department), **hires by year** (line, hire_date by year: peaks in 2015, 2020 and 2023, plus the 2027 outlier), **by work location** (JKT-HQ 84, BDG-01 37, SBY-01 23 before fixes). Every chart has a table view.

### 13. Data API

**Settings → API keys**: create a key with `datasets:read`, `domains:read`, `pipelines:run`, `runs:read`. Then (replace the host and key):

```bash
curl -H "Authorization: Bearer nxk_..." "https://<host>/api/v1/datasets/employees?fields=employee_code,full_name,department&filter[department]=Finance&limit=5"
```

```bash
curl -H "Authorization: Bearer nxk_..." "https://<host>/api/v1/datasets/employees?filter[hire_date][gte]=2024-01-01&limit=100"
```

```bash
curl -H "Authorization: Bearer nxk_..." "https://<host>/api/v1/domains/employee?limit=10"
```

```bash
curl -X POST -H "Authorization: Bearer nxk_..." "https://<host>/api/v1/pipelines/<pipeline-id>/runs"
```

```bash
curl -H "Authorization: Bearer nxk_..." "https://<host>/api/v1/runs/<run-id>"
```

✅ Responses carry `X-RateLimit-*` headers; `next_cursor` pages through results; an analyst-role key gets masked values; every read appears in the audit log as `API_READ`. The spec is at `/api/v1/openapi.json`.

### 14. Webhooks (inbound and outbound)

- **Inbound trigger**: in a pipeline's Schedule section enable the webhook trigger and copy the URL (shown once). `curl -X POST <url>` queues a run (trigger `webhook`).
- **Outbound** (local): run `node scripts/webhook-receiver.mjs <signing-secret>`, add `http://127.0.0.1:4020/hooks` in **Settings → Webhooks** for `run.succeeded`, `run.failed` and `dataset.updated`, and paste the signing secret into the receiver. **Send test**, then run a pipeline.
  ✅ The receiver prints each event with "signature OK" and the run counts. If you stop the receiver, deliveries are retried (1 m, 5 m, 30 m, 2 h).
- In production use a public https receiver, for example a request-bin service.

### 15. Audit trail

**Settings → Audit log**: every save, publish, rule, policy and catalog change from the scenarios above, with **before/after values** (for example the Map step change in scenario 7 and the policy changes in scenario 11). Secrets show only as "changed".

### 16. SSO (needs a real identity provider)

**Settings → SSO**: add an Entra ID / Google / Okta provider for a domain you control, publish the DNS TXT record `_nexus-sso.<domain>`, verify it, and sign in with **Sign in with SSO**. New users join with the default role and don't need TOTP. This can't be tested with the files here.
