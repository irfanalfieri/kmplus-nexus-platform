import type { HelpContent } from '../types'

/** The guide in English: the source of truth. id.ts mirrors every id and block shape. */
export const helpEn: HelpContent = {
  chapters: [
    // ── 1 ───────────────────────────────────────────────────────────────────
    {
      id: 'start',
      title: 'Getting started',
      summary: 'What Nexus does, how work flows through it, and how to find your way around.',
      screen: 'overview',
      sections: [
        {
          id: 'what',
          title: 'What Nexus is',
          blocks: [
            { kind: 'p', text: 'KMPlus Nexus is the integration platform behind the KMPlus products (KMS, LMS, TMS, PMS, CMS, IMS). It **connects** to the systems where your HR data already lives, **moves** that data through checked pipelines, **governs** who may see what, and **delivers** it to KMPlus products, to datasets you can analyze, and to other systems through an API and webhooks.' },
            { kind: 'diagram', diagram: 'workflow', caption: 'The workflow. Every screen in Nexus belongs to one of these stages; the guided tour visits them in this order, and the chapters of this guide follow it too.' },
            { kind: 'p', text: 'Nothing is copied by hand. A pipeline you publish runs on its schedule (or when another pipeline finishes, an API call or a webhook arrives), checks every row on the way, and holds back the rows that fail instead of losing them.' },
          ],
        },
        {
          id: 'terms',
          title: 'Words you will see',
          blocks: [
            {
              kind: 'table',
              head: ['Term', 'Meaning'],
              rows: [
                ['Connector', 'A kind of system Nexus can talk to (Talenta, SQL Server, S3, Vault …). Installed once per workspace.'],
                ['Data source', 'One connection with its sign-in: “HR database (production)”. Used as a source, a destination, or a secrets manager.'],
                ['Pipeline', 'Reads from a source, checks and shapes each row, writes to a dataset or a KMPlus product. Drawn as a line.'],
                ['Dataset', 'A table Nexus keeps for you, written by pipelines, read by the catalog, Analytics and the Data API.'],
                ['Run', 'One execution of a pipeline: queued → running → succeeded or failed, in chunks of 5,000 rows.'],
                ['Quarantine', 'Rows held back by a check or waiting for approval. Fixed rows are sent on from the step that held them.'],
                ['Business rule', 'A reusable check or decision (valid NIK, end date after start date) applied by any pipeline.'],
                ['Workspace', 'Your company’s space: its members, roles, data sources and pipelines.'],
                ['Environment', 'A workspace marked Development, Staging or Production. Pipelines move from one to the next by promotion.'],
                ['Nexus Agent', 'A small program in your network that reaches systems the cloud can’t (intranet databases and APIs).'],
              ],
            },
          ],
        },
        {
          id: 'around',
          title: 'Finding your way around',
          blocks: [
            { kind: 'shot', screen: 'overview', caption: 'The Overview: the last 24 hours as a readout, every pipeline as a line, and what needs you.' },
            {
              kind: 'list',
              items: [
                '**The rail** on the left groups screens by job: Build, Operate, Govern, Analyze and Workspace. Below 1024 px it opens from the menu button.',
                '**Go to… (Ctrl K)** in the top bar jumps to any screen or settings section by name.',
                '**Guide me** starts the guided tour; **Help & FAQ** opens this guide.',
                '**The bell** lists failed runs and held rows; the **account menu** switches theme and language and signs you out.',
                '**The workspace switcher** under the logo moves between your workspaces and environments.',
                'Every screen has its own address, so you can bookmark it or send it to a colleague.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'What you see depends on your role. A control you can’t use is hidden; the server checks every action again, so hiding is a convenience, not the protection.' },
          ],
        },
        {
          id: 'overview',
          title: 'Reading the Overview',
          blocks: [
            {
              kind: 'list',
              items: [
                '**The readout** counts the last 24 hours: runs, failures, rows written, rows held and datasets.',
                '**Lines** draws every pipeline from its source to where it writes. A red (tripped) line failed its last run or holds rows; teal lines are live. Tripped lines come first.',
                '**Needs you** collects held rows, approvals waiting for a second person, failed runs and disconnected sources, each with a link to the place that fixes it.',
                '**Set up your workspace** ticks off the first steps (connector, source, pipeline, first run, schedule) until they are all done.',
                '**Coming up** lists the next scheduled runs.',
              ],
            },
          ],
        },
        {
          id: 'first-day',
          title: 'Your first pipeline in five steps',
          blocks: [
            {
              kind: 'steps',
              items: [
                '**Connectors**: install the connector for your HR system (e.g. Talenta, SAP, or a database).',
                '**Data sources → Add source**: enter its sign-in and **Test**. Nexus lists the tables it can read.',
                '**Pipelines → New pipeline**: pick a template such as **HRIS → Employee**, choose the source table, and open the editor.',
                '**Test on sample** in the editor to see rows flow through each step, then **Save & publish** and set a schedule.',
                'Watch the first run in **Monitoring**, and fix any held rows in **Data quality**.',
              ],
            },
          ],
        },
        {
          id: 'prefs',
          title: 'Language, theme and time',
          blocks: [
            { kind: 'p', text: 'The account menu (your name, top right) switches the interface between **English** and **Bahasa Indonesia** and the theme between **light**, **dark** and **system**. The choice is remembered on this browser. Data, column names and identifiers are never translated.' },
            { kind: 'p', text: 'Times are shown in **Western Indonesian Time (WIB)**, and schedules are set in WIB. Timestamps stored without a zone are treated as UTC.' },
          ],
        },
      ],
    },
    // ── 2 ───────────────────────────────────────────────────────────────────
    {
      id: 'connect',
      title: 'Connect your systems',
      summary: 'Connectors, data sources, files, the Nexus Agent for your intranet, secrets managers, infrastructure sources and destinations.',
      screen: 'sources',
      sections: [
        {
          id: 'connectors',
          title: 'Connectors and categories',
          blocks: [
            { kind: 'shot', screen: 'connectors', caption: 'Connectors grouped by category, with search.' },
            {
              kind: 'table',
              head: ['Category', 'Examples'],
              rows: [
                ['Applications', 'SAP SuccessFactors / HCM, Talenta (Mekari), Salesforce'],
                ['KMPlus products', 'KMS, LMS, TMS, PMS, CMS, IMS (destinations)'],
                ['Databases & warehouses', 'PostgreSQL, MySQL, Microsoft SQL Server, Oracle, Snowflake, Supabase'],
                ['APIs', 'Any REST API, designed in a form'],
                ['Files', 'CSV and Excel upload'],
                ['Infrastructure', 'Prometheus, Elasticsearch / OpenSearch, Datadog, New Relic, Grafana, S3-compatible storage, Azure Blob, Google Cloud Storage'],
                ['Identity & directories', 'Active Directory / LDAP'],
                ['Secrets managers', 'HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager, Doppler'],
              ],
            },
            { kind: 'p', text: 'Search matches names and keywords in English and Indonesian, so “excel” finds file upload and cloud storage. Installing needs the *install connectors* permission (admins). Connectors marked premium may be billed later; today every connector installs free.' },
          ],
        },
        {
          id: 'sources',
          title: 'Add a data source',
          blocks: [
            { kind: 'shot', screen: 'sources', caption: 'Data sources, with what each is used as and when it was last tested.' },
            {
              kind: 'steps',
              items: [
                '**Add source** (or **Add destination**), pick an installed connector and fill in its sign-in. Password fields can hold a secret reference instead of the password (see Secrets managers).',
                '**Test** checks the connection and scans the tables and columns.',
                'Name it and choose what it is **used as**: a source (Nexus reads), a destination (Nexus writes), or both.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Credentials are encrypted with a key that belongs to your workspace and are never sent back to the browser. When you edit a source, secrets show as masked and stay unchanged unless you type a new one.' },
          ],
        },
        {
          id: 'browse',
          title: 'Test, browse and preview',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Browse tables** lists every table with its columns and types, and previews sample rows (masked for your role).',
                '**Re-test** after a password change or a schema change; the table list is refreshed.',
                'A source used by a pipeline can’t be deleted until the pipeline stops using it (drafts included).',
                'Nexus never creates or empties tables in your own databases. It writes only to data sources added as destinations, into tables that already exist.',
              ],
            },
          ],
        },
        {
          id: 'files',
          title: 'Files: CSV and Excel',
          blocks: [
            { kind: 'p', text: 'A **File Upload** source takes CSV, TSV or XLSX files of up to 50 MB. The file is read in your browser, typed (numbers, dates, true/false), and stored as a table Nexus can read like any other.' },
            {
              kind: 'list',
              items: [
                '**Upload a file** on the source: choose a sheet for Excel files, then **replace** the table or **append** to it.',
                'The next pipeline run reads the new rows; the **CSV / Excel → Dataset** template turns an upload into a dataset in one step.',
                'For recurring exports, drop files in a cloud storage folder instead (see Infrastructure).',
              ],
            },
          ],
        },
        {
          id: 'agent',
          title: 'Systems inside your network: the Nexus Agent',
          blocks: [
            { kind: 'diagram', diagram: 'architecture', caption: 'The Nexus Agent connects outward to Nexus. Nothing in your network needs to accept a connection from the internet.' },
            { kind: 'p', text: 'Databases and APIs on your intranet (addresses like `10.x`, `192.168.x` or `hr.company.local`) can’t be reached from the cloud, and Nexus refuses them on purpose. Install a **Nexus Agent** on a server inside the network instead: it connects **outward** over HTTPS, picks up work, runs it next to your systems, and returns only the results.' },
            {
              kind: 'steps',
              items: [
                '**Settings → Nexus Agents → Create agent**: name it and copy its configuration (shown once, with its token).',
                'Download the agent (one file, Node 20 or newer), write `nexus-agent.json` with the token and your connections (passwords can come from environment variables), and run it. `--check` tests the connections first.',
                'Back in Nexus the agent shows as online with its connections; **Add as source** turns a connection into a data source. Test it there to scan its tables.',
              ],
            },
            { kind: 'p', text: 'Agent-backed sources keep their passwords in the agent’s configuration on your server; Nexus stores none of them.' },
          ],
        },
        {
          id: 'intranet',
          title: 'Intranet APIs',
          blocks: [
            { kind: 'p', text: 'Intranet REST APIs work through the agent the same way: the agent holds the base URL and the sign-in, and Nexus sends only the request design (paths, paging, fields). Requests always stay under the agent’s base URL.' },
            { kind: 'p', text: 'If your IT team prefers to publish the API instead, Nexus can call it directly. The **Network** tab of the REST form sets a client certificate (mTLS), a company CA, and signed requests (`X-Nexus-Signature`), and lists Nexus’s fixed outbound IP addresses for your firewall.' },
          ],
        },
        {
          id: 'secrets',
          title: 'Secrets managers',
          blocks: [
            { kind: 'diagram', diagram: 'secrets', caption: 'Only the reference is saved. The value is read from your secrets manager when Nexus connects.' },
            { kind: 'p', text: 'Keep passwords in **HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager or Doppler**, and put a reference in the data source instead of the password:' },
            { kind: 'code', text: '{{secret:Vault prod:hr/postgres#password}}' },
            {
              kind: 'steps',
              items: [
                'Install the secrets manager’s connector and add it as a data source (it shows as **Secrets** under *Used as*).',
                'In another data source, click **Use a secret** next to a password field, pick the manager and the secret (names only, never values) and insert the reference.',
                '**Test**: Nexus reads the secret and connects. Rotate the secret in your manager and the next connection uses the new value within a minute.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Secrets managers are never data: they have no tables, don’t appear in pipelines, the catalog or AI drafts, and values are never written to the database, logs, audit entries or the browser.' },
          ],
        },
        {
          id: 'infrastructure',
          title: 'Infrastructure: observability and cloud storage',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Prometheus**: targets, alerts, rules and one table per PromQL query you name.',
                '**Elasticsearch / OpenSearch** (and Elastic APM): every index matching a pattern; incremental on a date field such as `@timestamp`.',
                '**Datadog**, **New Relic** and **Grafana**: monitors, SLOs, APM services, alert issues, dashboards and your own metric or NRQL queries.',
                '**S3-compatible storage** (S3, MinIO, R2 …), **Azure Blob** and **Google Cloud Storage**: every CSV, TSV, JSON, NDJSON or XLSX file is a table, and a folder of one format (`daily/*.csv`) is one table, so new daily exports keep feeding the same pipeline.',
              ],
            },
          ],
        },
        {
          id: 'destinations',
          title: 'Destinations: KMPlus products, your databases and REST APIs',
          blocks: [
            { kind: 'p', text: 'KMPlus products are destinations. Add the product as a data source (its URL and token), then end a pipeline with a destination step that writes to it. Nexus sends records through the **Nexus Ingest Contract**; records the product refuses are held in the quarantine at the destination step with the product’s reason, so you can fix and resend them.' },
            { kind: 'p', text: 'PostgreSQL, MySQL and Supabase sources added as destinations can receive rows too (append or upsert into an existing table).' },
            { kind: 'p', text: '**REST APIs** can receive rows as well: add the API with **Data sources → Add destination → REST API** (base URL, sign-in, headers, variables and the Network tab, exactly as for reading). The request itself (method, path and body) is designed in the pipeline’s Destination step (see 3.6). An API inside your network is reached through a Nexus Agent 1.3.0 or later with `"writable": true` on its connection.' },
            { kind: 'note', tone: 'info', text: 'A data source added as a destination whose type Nexus can’t write to yet stays visible in the Destination step, greyed out, so you know why it can’t be picked.' },
          ],
        },
      ],
    },
    // ── 3 ───────────────────────────────────────────────────────────────────
    {
      id: 'pipelines',
      title: 'Build pipelines',
      summary: 'Templates, the editor, steps, several sources with Join and Union, Aggregate and Deduplicate, API calls, checks, destinations, publishing, schedules, approvals, and environments with promotion.',
      screen: 'pipelines',
      sections: [
        {
          id: 'anatomy',
          title: 'Anatomy of a pipeline',
          blocks: [
            { kind: 'diagram', diagram: 'pipeline', caption: 'A typical pipeline. Rows that fail a check leave the line for the quarantine and come back after they are fixed.' },
            {
              kind: 'table',
              head: ['Step', 'What it does'],
              rows: [
                ['Source', 'Reads a table, query or API. Incremental reads keep a watermark, so each run reads only what changed.'],
                ['Filter', 'Keeps rows that match conditions (all / any, nested groups).'],
                ['Map', 'Renames and converts columns, and can map to a Unified Data Model entity such as Employee.'],
                ['Validate', 'Checks each row. Errors hold the row; warnings only note it.'],
                ['Rules', 'Applies business rules from the Rules screen, including rows that must wait for approval.'],
                ['Router', 'Sends rows down different branches by condition.'],
                ['Join', 'Adds the columns of another source by key, e.g. salary from the payroll API for each employee (see Several sources).'],
                ['Union', 'Stacks the rows of several sources, e.g. two HR systems, and records which one each row came from.'],
                ['Aggregate', 'One row per group with counts, sums, averages and more, e.g. headcount per unit per month.'],
                ['Deduplicate', 'Keeps one row per key, e.g. the latest record of each employee, and lists the rest in Data quality.'],
                ['Enrich', 'Asks an API about each row and adds the values it returns, e.g. grade and allowance from the HR API.'],
                ['Change data (API)', 'Creates or updates a record in another system for each row, e.g. a user account, and continues with the id it returns.'],
                ['Destination', 'Writes to a dataset or to a destination data source such as a KMPlus product.'],
              ],
            },
          ],
        },
        {
          id: 'create',
          title: 'Create a pipeline',
          blocks: [
            { kind: 'shot', screen: 'pipelines', caption: 'Pipelines: each one drawn as a line with its state, last run and schedule.' },
            {
              kind: 'list',
              items: [
                '**From a template**: HRIS → Employee (maps SAP, Talenta or any HR table to the Employee entity, checks it with the HR rule pack, keeps an up-to-date dataset and can also send it to a KMPlus product), Active Directory → Users, and CSV / Excel → Dataset.',
                '**Describe it**: write what you want in plain words and the AI assistant drafts the pipeline from your real sources and tables. The draft opens in the editor unsaved, for you to review.',
                '**From scratch**: add steps on the canvas and connect them.',
              ],
            },
          ],
        },
        {
          id: 'editor',
          title: 'The editor',
          blocks: [
            { kind: 'shot', screen: 'editor', caption: 'The pipeline editor: steps on a canvas, the selected step’s settings beside it.' },
            {
              kind: 'list',
              items: [
                '**Add after the selected step** on the left inserts Filter, Map & transform, Validate, Business rules, Router, Join, Union, Aggregate, Deduplicate, Enrich, Change data or Destination steps; **Source** adds another source to combine.',
                'Select a step to edit it on the right; **Next steps** connects it to the following steps (a Router has one per branch).',
                '**Run settings** sets retries, timeout, batch size, the quarantine threshold and when to alert (never, on failure, or on failure or held rows).',
                '**Schedule** sets when the published version runs (see Schedules and triggers).',
              ],
            },
          ],
        },
        {
          id: 'lanes',
          title: 'Several sources: Join and Union',
          blocks: [
            { kind: 'p', text: 'Client data rarely lives in one place: IDs and names in the HRIS, salaries in a payroll API, units in an org table. Add a **Source** step for each. Every source starts its own **lane** (the source and the steps its rows pass through), and lanes meet in a **Join** or a **Union**. Up to 10 sources per pipeline.' },
            {
              kind: 'list',
              items: [
                '**Driver**: with several sources, mark one as the driver (the canvas labels it). It streams in chunks like a single source; its max rows and sync mode apply as usual.',
                '**Join**: connect the rows to keep to its **left** side and the source to look up to its **right** side. Pick one or more key pairs (`employee_code` = `employee_code`).',
                '**Union**: connect two or more inputs. Columns are matched by name, a column one input lacks stays empty, and the `_source` column says which input each row came from.',
              ],
            },
            {
              kind: 'table',
              head: ['Join setting', 'Choices (default first)'],
              rows: [
                ['Type', 'Left: keep every left row · Inner: only rows with a partner · No match: only rows without a partner'],
                ['Compare keys', 'Ignore spaces and upper/lower case (on) · ignore leading zeros, so `00123` = `123` (off)'],
                ['Several matches', 'One row per match (a key found twice on the right writes the row twice) · First match by a column'],
                ['Rows without a partner', 'Keep with empty right columns · Drop · Quarantine, to replay once the partner exists'],
                ['Clashing column names', 'Right columns whose name the left side already has get a prefix: the right source’s table, e.g. `payroll_name`, or your own'],
              ],
            },
            { kind: 'p', text: 'Each run works in phases. First every Join’s right side is read in full, through its own steps, into **run staging** (up to 1,000,000 rows per Join; checkpointed, so a stopped run resumes where it was). Then the driver streams, each chunk looks up its keys, and Union partners stream after it. Staging is removed when the run ends. The run log says how many rows matched, how many multiplied and how much staging was used.' },
            { kind: 'p', text: '**Test on sample** reads a sample of the driver, then only the right-side rows with the sample’s keys (from databases and files; other sources read up to 5,000 rows), so a Join shows “18 of 25 matched”.' },
            { kind: 'note', tone: 'warning', text: 'Incremental driver with a Join: the looked-up sources are read in full every run, but only the rows the driver reads (new or changed) are joined. A change in payroll reaches an employee only when that employee’s own row changes too. Each source keeps its own sync position.' },
            { kind: 'note', tone: 'info', text: 'Rows held at a Join or after it replay from their step as usual. Rows held inside a lane that feeds a Join’s right side can’t be replayed into a finished join: run the pipeline again after fixing the source.' },
          ],
        },
        {
          id: 'blocking',
          title: 'Aggregate and Deduplicate',
          blocks: [
            { kind: 'p', text: 'These two steps need every row before they can answer, so a run first reads its sources, holds the rows that reach them, then answers group by group and sends the result on to the next steps.' },
            {
              kind: 'table',
              head: ['Step', 'Settings'],
              rows: [
                ['Aggregate', 'Group by columns and, optionally, a time bucket on a date column (day, week from Monday, month, quarter, year). Measures: count, count distinct, sum, average, minimum, maximum, first / last by a column, join as text, collect as a list; each can count only rows matching a condition (e.g. `active_headcount` = count where status = Active).'],
                ['Deduplicate', 'Key columns (compared ignoring spaces and case, like Join keys). Keep the most recent row by a date column (the default when there is one), the first one read, or the last one read.'],
              ],
            },
            {
              kind: 'list',
              items: [
                'Removed duplicates are listed in **Data quality** as flags, each naming the row that was kept. Nothing is held; flags don’t make a run partial.',
                'An Aggregate needs a **full read** of the sources feeding it: an incremental read would count only the changed rows, so the editor refuses it.',
                'Rows held earlier in the lane (failed checks) are not counted; the run log says how many. Fix them and run the pipeline again rather than replaying them.',
                'An Aggregate can also prepare a Join’s looked-up side, e.g. sum allowances per employee, then join them to each employee.',
                '**Test on sample** aggregates the sample only; the test says so.',
              ],
            },
          ],
        },
        {
          id: 'api-steps',
          title: 'API calls inside a pipeline',
          blocks: [
            { kind: 'p', text: 'Two steps call a REST API data source with its sign-in, headers and network settings. **Enrich** only reads; **Change data (API)** creates or updates records in the other system and is drawn as an outward action on the canvas.' },
            {
              kind: 'table',
              head: ['Enrich setting', 'What it does'],
              rows: [
                ['Requests', 'One per row (`GET /employees/{{employee_code}}/details`), or a batch: the keys in a query parameter (`?codes=E1,E2`) or in a POST body list, with the answer field that names each item’s key.'],
                ['Values from the answer', 'Paste an example answer or **Send test call**, pick the values you need, name the new columns and set their types. A list in the answer gives one row per item (rows can multiply), the first item, or JSON lists.'],
                ['No answer', '404 or no item for the key: keep the row with empty values, drop it, or quarantine it. Other refusals (4xx) are quarantined with the API’s reason; 5xx and 429 are retried.'],
                ['Cache', 'Answers are kept between runs (24 hours by default, at most 7 days; “not found” for an hour). Only the picked values are kept, encrypted. **Clear cache** asks again; a changed mapping asks again too.'],
                ['Limits', 'Requests per second, how many at once, and a timeout. A run makes at most 50,000 calls to a data source; an admin can raise that in the step.'],
              ],
            },
            {
              kind: 'list',
              items: [
                '**Change data (API)**: a create request (POST, PUT or PATCH; no DELETE) and, optionally, an update request used when a record created before has changed data. Its path can use values the create answer returned, e.g. `/users/{{user_id}}`.',
                'Each record is created once: a call ledger remembers every successful call by the key columns, so a retry, a resumed run or a replay never creates it again. Every call also carries an **Idempotency-Key**.',
                'A later step failing does not undo a change already made in the other system; fix the problem and run again.',
                '**Test on sample** sends nothing for this step (a dry run). **Send one test call** creates the record for real after you confirm it, and records it.',
                'A pipeline with this step always needs a second person’s approval when your workspace approves destructive changes.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Test on sample asks an Enrich step’s API for the first 5 requests only; the other sample rows show empty values. For APIs inside your network, the Nexus Agent (1.4.0 or later) sends the calls.' },
          ],
        },
        {
          id: 'mapping',
          title: 'Mapping and transforms',
          blocks: [
            { kind: 'p', text: 'The **Map & transform** step lists every output column with its source column and type. **Auto-map** matches HR synonyms (e.g. `PERNR`, `NIK`, `employee_no`) to the canonical names of the Unified Data Model, and saved mapping templates (built-in for SAP, Talenta and Active Directory) fill a whole step at once.' },
            {
              kind: 'table',
              head: ['Kind', 'Transforms'],
              rows: [
                ['Text', 'trim, upper / lower / title case, replace, regex replace and extract, prefix, suffix, substring, concat, split'],
                ['Values', 'default if empty, coalesce, conditional (if … then … else)'],
                ['Numbers & dates', 'to number, round, number format, format date (with input format and time zone), to boolean'],
                ['Privacy', 'hash (a stable pseudonym)'],
                ['Lookups', 'lookup a value in another dataset, e.g. `ORG_CODE` → organization name'],
              ],
            },
          ],
        },
        {
          id: 'checks',
          title: 'Validation checks',
          blocks: [
            { kind: 'p', text: 'The **Validate** step runs checks on every row. Each check has a severity: **error** holds the row in quarantine, **warning** and **info** only note it on the run.' },
            {
              kind: 'list',
              items: [
                '**Format**: required, email, phone, NIK, NPWP, regex, minimum and maximum length, one of a list.',
                '**Values and dates**: minimum, maximum, valid date, not in the future, compare two fields (end date after start date).',
                '**Across rows and datasets**: unique, exists in another dataset, manager hierarchy (every manager exists, no loops).',
                '**Conditions**: any condition built with the rule builder.',
              ],
            },
            { kind: 'p', text: 'The HRIS → Employee template adds an **HR rule pack** of these checks for the columns it finds.' },
          ],
        },
        {
          id: 'writing',
          title: 'Destinations and write modes',
          blocks: [
            {
              kind: 'table',
              head: ['Mode', 'What happens'],
              rows: [
                ['Replace', 'The dataset is rebuilt from this run; readers see the old rows until the new ones are complete.'],
                ['Append', 'Rows are added. A resumed or retried chunk replaces its own earlier copy, so nothing is written twice.'],
                ['Upsert', 'Rows are matched on key columns and updated or inserted. **Mark rows missing from the source as deleted** soft-deletes people who left (needs full reads, not incremental).'],
              ],
            },
            { kind: 'p', text: 'A pipeline can have several destinations, e.g. the employees dataset and a KMPlus product.' },
            { kind: 'p', text: '**Datasets with a defined schema** list their columns in the Destination step: choose what each takes, and upserts match on the schema’s keys. See *Defined dataset schemas* in the Catalog chapter.' },
            { kind: 'p', text: '**Sending rows to a REST API.** Pick a REST data source in the Destination step, then set the method (POST, PUT or PATCH) and the path. `{{column}}` in the path takes each row’s value, e.g. `PUT /employees/{{employee_id}}`.' },
            {
              kind: 'steps',
              items: [
                '**Edit body** and paste an example of the body the API expects, as JSON, form-encoded (`name=value&…`) or XML.',
                '**Read example** turns it into a list of values (`employee.name`, `contacts[].email`, …) and matches them to columns by name and HR synonyms. Set each value to a column, a fixed value, a calculation or run information (run id, batch id, rows in the request, time sent); mark values as required and choose what an empty value becomes.',
                'To send several rows in one request, choose the list that holds the rows under **Rows per request** (a top-level list is chosen for you; in XML, choose the element to repeat). Otherwise each row is its own request.',
                'Run **Test on sample**, then **Preview request** (a dry run that sends nothing) or **Send test request**, which sends the first row to the real API and shows the request, with sign-in masked, and the answer.',
              ],
            },
            {
              kind: 'table',
              head: ['The API answers', 'What Nexus does'],
              rows: [
                ['2xx', 'Written. If the answer lists refused items (set the list path under **Refused items in a 2xx answer**), only those rows go to Data quality with the API’s message.'],
                ['Another 4xx', 'Those rows go to Data quality with the status and a short reason (emails and long numbers blanked). Fix them and replay from the destination step.'],
                ['408, 429, 5xx or no answer', 'Retried up to 4 times with backoff, honouring Retry-After; then the run retries from its last checkpoint.'],
                ['401 or 403, a redirect, or 404 for every request', 'The run stops: sign-in, base URL or path need fixing.'],
              ],
            },
            { kind: 'note', tone: 'warning', text: 'An API can’t give the exactly-once guarantee datasets have. When a run is retried, rows already sent can be sent again: POST then creates duplicates. Prefer PUT or PATCH to a path with the record’s key, or turn on **Send an idempotency key** (a stable run:chunk:batch key) if the API supports it. Rows per request, max requests per second (10 by default), parallel requests (1–4) and the timeout are set on the step; Nexus keeps chunks small enough to finish at that pace.' },
            { kind: 'p', text: 'The step warns when the body sends columns classified personal or sensitive in Governance. Request bodies are never written to logs.' },
          ],
        },
        {
          id: 'publish',
          title: 'Test, save, publish and versions',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Test on sample** reads real rows, runs every step and writes nothing. Each step then shows how many rows passed, changed or were held; select a step to see its rows (masked for your role).',
                '**Save draft** keeps your changes; the **published** version keeps running until you **Save & publish**.',
                'Every publish is a version with an optional change note. The version history can **restore** an earlier version: it becomes the running version (after approval, if your workspace requires it).',
                'When a run fails, **Diagnose with AI** explains the failure from the step messages (never the row values) and can suggest a fix as a new draft.',
              ],
            },
          ],
        },
        {
          id: 'schedule',
          title: 'Schedules and triggers',
          blocks: [
            {
              kind: 'table',
              head: ['Trigger', 'When it runs'],
              rows: [
                ['Manual', '**Run now** on the Pipelines screen or in the editor.'],
                ['Schedule', 'Hourly, daily, weekly or monthly at a time (WIB), or a cron expression.'],
                ['After another pipeline', 'When a chosen pipeline finishes (successfully, also partly, or always), for chains like “employees, then org units”. Loops are refused.'],
                ['Webhook', 'An HTTP call to the pipeline’s secret URL, e.g. from your HR system when data changes.'],
                ['Data API', '`POST /api/v1/pipelines/{id}/runs` with a key that has the `pipelines:run` scope.'],
              ],
            },
            { kind: 'p', text: 'Only one run per pipeline is active at a time. Runs process 5,000 rows per chunk and save a checkpoint after each, so a long run resumes where it stopped instead of starting over.' },
          ],
        },
        {
          id: 'approvals',
          title: 'Publish approvals',
          blocks: [
            { kind: 'p', text: 'A workspace can require a **second person** to approve a version before it runs. Set it in **Settings → Approvals & environments**:' },
            {
              kind: 'table',
              head: ['Setting', 'What waits for approval'],
              rows: [
                ['Off', 'Nothing: editors publish directly.'],
                ['Destructive changes', 'Versions that replace a dataset or mark rows deleted.'],
                ['Every publish', 'Every version, including promotions into this workspace.'],
              ],
            },
            { kind: 'p', text: 'Waiting versions appear under **Approval history** on the Pipelines screen and in **Needs you** on the Overview. An admin or data steward approves or rejects them; nobody approves their own change, so approvals need at least two admins or stewards.' },
          ],
        },
        {
          id: 'environments',
          title: 'Environments: Development, Staging, Production and promotion',
          blocks: [
            { kind: 'p', text: 'Build and test pipelines safely before they touch production data. An **environment group** links up to three workspaces as **Development → Staging → Production**. Each keeps its **own members, data sources and credentials**, so Development can read a test HR database while Production reads the real one, with the same pipeline.' },
            { kind: 'diagram', diagram: 'environments', caption: 'The promotion path. A pipeline is built in Development and moves forward one environment at a time; Production changes only by promotion.' },
            { kind: 'shot', screen: 'environments', caption: 'Settings → Approvals & environments: the linked workspaces, which one is locked, and where pipelines promote to.' },
            {
              kind: 'steps',
              items: [
                '**Set up**: in the Development workspace open **Settings → Approvals & environments → Set up environments**, say which stage this workspace is, and create the missing ones (you become their admin). Or **Link a workspace** you already administer as a stage.',
                '**Prepare each environment**: add the same data sources by **name** in Staging and Production (e.g. “HR database”), each with its own connection and credentials. Invite the people who work there.',
                '**Build and publish in Development**, test it on its sample and runs.',
                '**Promote**: on the Pipelines screen open the pipeline’s menu → **Promote to Staging**. The preview shows what the promotion maps.',
                'Check the result in Staging, then promote from Staging to **Production** the same way.',
              ],
            },
            {
              kind: 'table',
              head: ['Promotion maps', 'How'],
              rows: [
                ['Data sources', 'By name and connector type: the pipeline uses the target’s own source and credentials. A missing one blocks the promotion until you add it there.'],
                ['Business rules', 'By name: created in the target, or updated to the promoted version.'],
                ['Chained pipelines', '“Run after” and “trigger pipeline” references follow the same pipeline in the target, so promote those first.'],
                ['Datasets', 'By name; nothing to map.'],
              ],
            },
            {
              kind: 'list',
              items: [
                'Promotion copies the **published** version, so publish first. A new pipeline is created in the target with its **schedule off** until someone turns it on; an existing one is updated to the new version.',
                'If the target requires approvals, the promoted version **waits there** for a second person before it runs.',
                '**Production starts locked**: pipelines there can’t be edited directly, only promoted into. Runs, schedules and approvals work as usual. An admin can unlock it (and lock it again).',
                'Each pipeline row shows its version in the next environment (e.g. `STAGING: v3` or `not promoted`).',
                'You need to be an admin or data steward in the target environment to promote into it. Every promotion is recorded in the audit log.',
              ],
            },
          ],
        },
      ],
    },
    // ── 4 ───────────────────────────────────────────────────────────────────
    {
      id: 'rules',
      title: 'Business rules',
      summary: 'Checks and decisions written once and reused across pipelines.',
      screen: 'rules',
      sections: [
        {
          id: 'rules-what',
          title: 'Rules in practice',
          blocks: [
            { kind: 'shot', screen: 'rules', caption: 'Business rules with where each is used.' },
            { kind: 'p', text: 'A rule reads **IF** a condition **THEN** do something, **OTHERWISE** do something else. Rules are shared: change a rule once and every pipeline that uses it applies the new version on its next run. Filter, Validate, Router and Business rules steps can all use them.' },
          ],
        },
        {
          id: 'conditions',
          title: 'Conditions and expressions',
          blocks: [
            { kind: 'p', text: 'Conditions combine field comparisons with **all** / **any** and nested groups. A value can be a fixed value, another field, or an expression such as `days_between(start_date, today())`, `upper(name)` or `year(hire_date)`.' },
          ],
        },
        {
          id: 'actions',
          title: 'What a rule can do',
          blocks: [
            {
              kind: 'table',
              head: ['Action', 'Effect'],
              rows: [
                ['Include / exclude', 'Keep the row or drop it from this run.'],
                ['Set field / calculate', 'Write a value or an expression into a column.'],
                ['Route', 'Send the row down a named branch of a Router step.'],
                ['Notify', 'Email admins and stewards, or the addresses you list (once per run).'],
                ['Require approval', 'Hold the row in quarantine until a second person approves it.'],
                ['Trigger pipeline', 'Queue another pipeline after this run.'],
              ],
            },
          ],
        },
        {
          id: 'test-rule',
          title: 'Test and version a rule',
          blocks: [
            { kind: 'p', text: 'The rule editor’s **tester** runs the rule on rows from a dataset or on JSON you paste, and shows which branch each row takes. Every save is a version; edits are recorded in the audit log.' },
          ],
        },
      ],
    },
    // ── 5 ───────────────────────────────────────────────────────────────────
    {
      id: 'monitoring',
      title: 'Monitor runs',
      summary: 'Runs, schedules, the background worker, alerts and webhooks.',
      screen: 'monitoring',
      sections: [
        {
          id: 'runs',
          title: 'Runs and the worker',
          blocks: [
            { kind: 'shot', screen: 'monitoring', caption: 'Monitoring: health of the worker and scheduler, then every run.' },
            { kind: 'p', text: 'Runs execute in the background, so closing the browser never stops them. Monitoring shows today’s outcomes, a seven-day chart, the health of each pipeline (stalled jobs are flagged), background runs with live progress, and recent runs.' },
          ],
        },
        {
          id: 'read-run',
          title: 'Reading a run',
          blocks: [
            { kind: 'p', text: 'Open a run to see its trigger, version, duration, rows read, written and held per step and per destination, and its log. Admins also see the technical detail of an error.' },
          ],
        },
        {
          id: 'retry',
          title: 'Cancel, retry and resume',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Cancel** a queued or running job.',
                '**Retry** a finished run. It resumes from the last checkpoint instead of starting over.',
                'Temporary problems (a network timeout) retry automatically; configuration problems (a wrong password, a missing table) don’t, so fix them and run again.',
                'Incremental watermarks move only after the whole run succeeds, so a failed run never skips rows.',
              ],
            },
          ],
        },
        {
          id: 'alerts',
          title: 'Alerts and notifications',
          blocks: [
            { kind: 'p', text: 'A failed run creates a notification in the bell and an email to the people who should know; a pipeline can also alert on held rows (Run settings). Alerting never fails a run. For other systems, use webhooks (see Data API and webhooks).' },
          ],
        },
      ],
    },
    // ── 6 ───────────────────────────────────────────────────────────────────
    {
      id: 'quality',
      title: 'Data quality',
      summary: 'The quarantine inbox: fix, approve, dismiss and replay held rows; quality scores over time.',
      screen: 'quality',
      sections: [
        {
          id: 'inbox',
          title: 'The quarantine inbox',
          blocks: [
            { kind: 'shot', screen: 'quality', caption: 'Held rows with the problem, the row, and the pipeline step that held it.' },
            { kind: 'p', text: 'Every held row shows the problem in words, the row itself (failing fields highlighted), and the pipeline and step that held it. Filter by **Needs action**, **Failed a check**, **Needs approval**, **Flagged** or **Fixed, not replayed**, and by pipeline.' },
          ],
        },
        {
          id: 'why-held',
          title: 'Why a row is held',
          blocks: [
            {
              kind: 'table',
              head: ['Kind', 'Meaning'],
              rows: [
                ['Failed a check', 'A Validate error or a KMPlus product refused the record. Fix the value.'],
                ['Needs approval', 'A business rule asks a second person to confirm the row. Approve or dismiss it.'],
                ['Flagged', 'A warning worth a look; the row was still written.'],
              ],
            },
          ],
        },
        {
          id: 'fix',
          title: 'Fix, approve, dismiss and replay',
          blocks: [
            {
              kind: 'steps',
              items: [
                '**Fix** a row: edit the failing value, then **Save & replay** (or fix-and-next to work through a list). Several rows with the same problem can be fixed at once.',
                '**Approve** rows that wait for approval, or **Dismiss** rows that should not move (undo is offered).',
                'Replay sends the rows through the **published** pipeline from the step that held them, so they still pass every later check.',
              ],
            },
            { kind: 'p', text: 'A newer full run replaces older open rows of the same pipeline; your fixes and approvals carry over to identical rows. Masked values can’t be edited by roles that see them masked.' },
          ],
        },
        {
          id: 'scores',
          title: 'Quality scores and trends',
          blocks: [
            { kind: 'p', text: 'Each pipeline has a quality score, and every dataset records its completeness, uniqueness and validity daily, with a 30-day trend in the catalog.' },
          ],
        },
      ],
    },
    // ── 7 ───────────────────────────────────────────────────────────────────
    {
      id: 'catalog',
      title: 'Catalog and lineage',
      summary: 'Find any dataset or source table, document it, see where it comes from, and query sources live.',
      screen: 'catalog',
      sections: [
        {
          id: 'find',
          title: 'Finding data',
          blocks: [
            { kind: 'shot', screen: 'catalog', caption: 'The catalog: datasets and source tables with owners, tags and documentation.' },
            { kind: 'p', text: 'Every dataset and every source table appears automatically. **Search in plain words**: “employees who joined last month” finds tables by name, documentation and column names, in English or Indonesian (never by row values).' },
          ],
        },
        {
          id: 'document',
          title: 'Documenting a dataset',
          blocks: [
            { kind: 'p', text: 'Stewards add an owner, a steward, a classification, tags, a description and column descriptions. Each item also shows its freshness, quality history and a masked, row-filtered sample. Datasets can be published as Unified Data Model entities (Employee, Organization, Position …) for the Data API.' },
          ],
        },
        {
          id: 'schemas',
          title: 'Defined dataset schemas',
          blocks: [
            { kind: 'p', text: 'A dataset’s columns are normally whatever its pipelines write. A **defined schema** makes the dataset own them: each column has a type, required or optional, and a classification that feeds Governance masking; key columns match rows for upserts and replays. Several pipelines can then fill one dataset, each its own columns.' },
            {
              kind: 'steps',
              items: [
                'Open the dataset in the Catalog and, under **Schema**, choose **Define from current columns** (nothing is reloaded), **From a business entity** (Employee, Organization …) or **From an example** (a JSON object or a CSV header). **New dataset** starts an empty dataset the same way.',
                'Set the **key columns** and what is required. Stewards and admins edit schemas; every change is a version in **History**, audited, and sent as a `dataset.schema_changed` webhook.',
                'In each pipeline’s Destination step, choose what every schema column takes: a column, a fixed value, or **not written**. **Match columns** fills it in by name and HR synonyms. A pipeline writes only the columns it maps, matched on the keys, so the HRIS pipeline can fill names and the LMS pipeline training hours.',
              ],
            },
            {
              kind: 'table',
              head: ['Change', 'What happens'],
              rows: [
                ['Add a column', 'Added at once, empty or with its default.'],
                ['Make required', 'Rows without a value are counted first. Later runs hold rows that don’t fill it.'],
                ['Rename', 'The column keeps its values. Pipeline drafts, dashboards and masks move to the new name, published pipelines follow it, and the Data API serves the old name for **30 days** with a `Deprecation` header.'],
                ['Change type', 'Values that can’t convert are counted first and emptied if you continue.'],
                ['Remove', 'Confirmed with the pipelines, dashboards and API keys that use the dataset.'],
              ],
            },
            { kind: 'p', text: 'Columns a pipeline sends that the schema lacks are not written: Test and Save ask **Fix the mapping** or **Drop them and continue**. With **Add new columns automatically**, columns matched by name are added instead, flagged for review, and stay out of the Data API until a steward marks them reviewed. A row missing a required value or holding a value that doesn’t convert goes to Data quality from the Destination step.' },
            { kind: 'note', tone: 'info', text: 'Promoting a pipeline also promotes the schemas of the datasets it writes: a new schema is created and added columns go along. A type change, key change or removed column in the next environment blocks the promotion until it is changed there.' },
          ],
        },
        {
          id: 'lineage',
          title: 'Lineage',
          blocks: [
            { kind: 'p', text: 'The **lineage graph** draws which pipelines read and write each dataset, back to the source tables and forward to destinations, so you can see what a change would affect.' },
          ],
        },
        {
          id: 'live',
          title: 'Live or cached source tables',
          blocks: [
            { kind: 'p', text: 'A source table can be queried **live** (read-only, with a row limit and a time limit, filters pushed to the source) or **cached**: Nexus keeps a copy with a managed pipeline every 5 minutes to daily, after another pipeline, or by hand.' },
          ],
        },
      ],
    },
    // ── 8 ───────────────────────────────────────────────────────────────────
    {
      id: 'governance',
      title: 'Governance and privacy',
      summary: 'Classification, masking, row filters, retention, erasure (UU PDP) and the audit trail.',
      screen: 'governance',
      sections: [
        {
          id: 'controls',
          title: 'The controls overview',
          blocks: [
            { kind: 'shot', screen: 'governance', caption: 'Governance: the controls overview, then dataset policies with classified and masked columns.' },
            { kind: 'p', text: 'The top of the Governance screen checks the workspace at a glance: two-factor authentication, encrypted credentials, the audit trail, datasets with a policy, retention and server-enforced roles. Anything that needs attention says so with a mark and words.' },
          ],
        },
        {
          id: 'masking',
          title: 'Classification and masking',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Classify** each column as public, internal, personal or sensitive. Nexus suggests a class and mask for common HR columns such as NIK, NPWP, salary and phone; suggestions apply only once you save the policy.',
                '**Mask** columns for roles without unmasked access: hide the value, keep the last four characters (`••••0001`), or replace it with a stable pseudonym (hash) so counts and joins still line up.',
                '**Preview as analyst** shows the dataset as a restricted role sees it.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Masks and row filters apply everywhere data is shown: dataset previews, the catalog, Analytics, AI answers and the Data API. Admins and data stewards see real values.' },
          ],
        },
        {
          id: 'row-filters',
          title: 'Row filters per role',
          blocks: [
            { kind: 'p', text: 'A row filter limits which rows a role sees, e.g. viewers see only `business_unit = Retail`. Filters use equals, not equals or a list of values, and apply in the same places as masks.' },
          ],
        },
        {
          id: 'retention',
          title: 'Retention and erasure (UU PDP)',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Retention** deletes rows older than a period you set per dataset; it is checked every hour.',
                '**Right to erasure** (admins) finds one person’s records in every dataset by a match column and an exact value (e.g. `employee_id = E00123`), shows how many rows match, and erases them after you confirm. Remove the person from the source system too, or the next run brings them back. The erasure is recorded in the audit log.',
              ],
            },
          ],
        },
        {
          id: 'audit',
          title: 'The audit trail',
          blocks: [
            { kind: 'p', text: '**Settings → Audit log** lists sign-ins, every change (with the values before and after) and every view of real data, with the person, time, IP address and browser. Secrets are recorded only as “changed”.' },
          ],
        },
      ],
    },
    // ── 9 ───────────────────────────────────────────────────────────────────
    {
      id: 'analytics',
      title: 'Analytics',
      summary: 'Dashboards and plain-language questions over your datasets.',
      screen: 'analytics',
      sections: [
        {
          id: 'dashboards',
          title: 'Dashboards',
          blocks: [
            { kind: 'shot', screen: 'analytics', caption: 'Analytics: dashboards built from datasets.' },
            { kind: 'p', text: 'A dashboard is a set of widgets: a number, a bar or line chart, or a table, each over one dataset. Every chart has a table view, and each widget shows how fresh its data is.' },
          ],
        },
        {
          id: 'widget',
          title: 'Building a widget',
          blocks: [
            {
              kind: 'steps',
              items: [
                'Choose the dataset and the widget type.',
                'Pick a **measure** (count, distinct count, sum, average, minimum, maximum) and a **group by**, with a time grain for dates (day, week, month, quarter, year).',
                'Add filters, a sort and a limit; the preview updates as you go. Save the dashboard.',
              ],
            },
          ],
        },
        {
          id: 'ask',
          title: 'Asking questions in words',
          blocks: [
            { kind: 'p', text: '**Ask a question** (“headcount by department this year”) and the AI assistant drafts a widget from the dataset’s real columns. You can keep it, change it or discard it.' },
          ],
        },
        {
          id: 'readers',
          title: 'What readers see',
          blocks: [
            { kind: 'p', text: 'Queries are read-only and stop after 15 seconds. Each reader sees the dashboard through their own role: masked columns can’t be grouped or filtered, and row filters apply to every number.' },
          ],
        },
      ],
    },
    // ── 10 ──────────────────────────────────────────────────────────────────
    {
      id: 'api',
      title: 'Data API and webhooks',
      summary: 'Read datasets from other systems, run pipelines remotely, and get told when things happen.',
      screen: 'settings',
      sections: [
        {
          id: 'keys',
          title: 'API keys and scopes',
          blocks: [
            { kind: 'p', text: 'Create a key under **Settings → API keys** with the scopes it needs, a role and an optional expiry. The key reads as that role, with its masks and row filters. It is shown once; Nexus keeps only a hash, and you can revoke it any time.' },
            {
              kind: 'table',
              head: ['Scope', 'Allows'],
              rows: [
                ['`datasets:read`', 'Read datasets and live catalog tables.'],
                ['`domains:read`', 'Read Unified Data Model entities (Employee, Organization …).'],
                ['`pipelines:run`', 'Start pipeline runs.'],
                ['`runs:read`', 'Read run status and results.'],
              ],
            },
          ],
        },
        {
          id: 'read',
          title: 'Reading data',
          blocks: [
            { kind: 'code', text: 'curl -H "Authorization: Bearer nxk_…" "https://<your-nexus>/api/v1/datasets/employees?fields=nik,full_name&limit=100"' },
            { kind: 'p', text: 'Responses page with a cursor, filter by fields and `updated_since`, and carry rate-limit headers. Every read is recorded in the audit log. The full reference is at `/api/v1/openapi.json`.' },
          ],
        },
        {
          id: 'remote-run',
          title: 'Running pipelines from other systems',
          blocks: [
            { kind: 'p', text: '`POST /api/v1/pipelines/{id}/runs` starts a run; `GET /api/v1/runs/{id}` follows it. A pipeline can also be started by its own secret webhook URL, set in the editor’s Schedule tab.' },
          ],
        },
        {
          id: 'webhooks',
          title: 'Outbound webhooks',
          blocks: [
            { kind: 'p', text: '**Settings → Webhooks** sends signed events (`run.succeeded`, `run.failed`, `dataset.updated`) to your HTTPS endpoint. Verify the signature with the signing secret; failed deliveries are retried.' },
          ],
        },
      ],
    },
    // ── 11 ──────────────────────────────────────────────────────────────────
    {
      id: 'admin',
      title: 'Administer the workspace',
      summary: 'Roles, members and invites, sign-in and SSO, settings and the AI assistant.',
      screen: 'settings',
      sections: [
        {
          id: 'roles',
          title: 'Roles',
          blocks: [
            { kind: 'diagram', diagram: 'roles', caption: 'What each role can do. The server enforces this table on every action.' },
          ],
        },
        {
          id: 'members',
          title: 'Members and invites',
          blocks: [
            { kind: 'p', text: '**Settings → Members & roles**: invite people by email (they get a link), change roles, and remove members. Everyone starts with a personal workspace; the last admin can’t leave a workspace.' },
          ],
        },
        {
          id: 'sso',
          title: 'Sign-in, SSO and SCIM',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Single sign-on** with OIDC or SAML 2.0 (Microsoft Entra ID, Google, Okta and others). Verify your email domain with a DNS TXT record; people at that domain then join this workspace with a default role on first sign-in.',
                '**Require SSO** blocks password sign-in for the domain.',
                '**SCIM** lets your identity provider create accounts and deactivate them the moment HR offboards someone; groups mapped to roles set members’ roles.',
              ],
            },
          ],
        },
        {
          id: 'settings-tabs',
          title: 'Settings at a glance',
          blocks: [
            { kind: 'shot', screen: 'settings', caption: 'Settings, with a tab per area.' },
            {
              kind: 'table',
              head: ['Tab', 'What you manage'],
              rows: [
                ['General', 'The workspace name.'],
                ['Members & roles', 'Invite people, change roles, remove members.'],
                ['Your account', 'Your own two-factor authentication and backup codes.'],
                ['Sign-in, SSO & SCIM', 'Single sign-on with verified domains, and SCIM provisioning.'],
                ['Approvals & environments', 'Whether publishes need a second person; Development, Staging and Production; locking.'],
                ['Nexus Agents', 'Agents in your network and their status.'],
                ['AI assistant', 'Which open-source model the assistant uses: the server’s, one next to an agent, or off.'],
                ['API keys · Webhooks', 'Data API keys and outbound webhooks.'],
                ['Audit log', 'Every change and every view of real data, with who, when and from where.'],
              ],
            },
          ],
        },
        {
          id: 'ai',
          title: 'The AI assistant',
          blocks: [
            { kind: 'p', text: 'The assistant drafts pipelines, explains failed runs, suggests connectors, searches the catalog and answers questions in Analytics. It uses **open-source models only**, through the server’s model or a model running next to your Nexus Agent, so prompts can stay inside your network. Admins choose the model or turn it off; everything else works without it.' },
          ],
        },
      ],
    },
    // ── 12 ──────────────────────────────────────────────────────────────────
    {
      id: 'security',
      title: 'Security',
      summary: 'How Nexus protects accounts, credentials, networks and data.',
      sections: [
        {
          id: 'accounts',
          title: 'Accounts and two-factor authentication',
          blocks: [
            { kind: 'p', text: '**Every account uses two-factor authentication** (an authenticator app, with ten backup codes), unless it signs in through your company’s SSO. Lost your phone? Sign in with a backup code and set up the new phone under **Settings → Your account**; an admin can reset it for you.' },
          ],
        },
        {
          id: 'credentials',
          title: 'Credentials and encryption',
          blocks: [
            { kind: 'p', text: 'Credentials are encrypted with AES-256-GCM using a key derived for your workspace, never returned to the browser and never written to logs. Keep them out of Nexus entirely with a secrets manager or a Nexus Agent.' },
          ],
        },
        {
          id: 'network',
          title: 'Network safety',
          blocks: [
            { kind: 'p', text: 'Connector requests from the cloud refuse private and intranet addresses and check every redirect; webhooks and SSO discovery accept only public HTTPS. The agent only ever connects outward.' },
          ],
        },
        {
          id: 'ai-data',
          title: 'AI and your data',
          blocks: [
            { kind: 'p', text: 'Prompts carry table and column names and examples from public columns only; personal and masked columns are left out, and check messages are redacted. AI answers are always drafts you review. Assistant use is audited without the prompt text.' },
          ],
        },
      ],
    },
  ],
  faqGroups: [
    { id: 'basics', title: 'Basics' },
    { id: 'connecting', title: 'Connecting systems' },
    { id: 'pipelines', title: 'Pipelines and runs' },
    { id: 'environments', title: 'Environments and promotion' },
    { id: 'quality', title: 'Data quality' },
    { id: 'access', title: 'Access, privacy and security' },
    { id: 'ai', title: 'AI assistant' },
  ],
  faqs: [
    { id: 'what-workspace', group: 'basics', q: 'What is a workspace?', a: 'Your company’s space in Nexus: members and roles, data sources, pipelines, datasets and settings. You can belong to several and switch from the rail. Data never crosses workspaces.' },
    { id: 'language', group: 'basics', q: 'How do I switch to Bahasa Indonesia or dark mode?', a: 'Open the account menu (your name, top right) and choose **Language** or **Appearance**. The choice is remembered on this browser.' },
    { id: 'times', group: 'basics', q: 'Which time zone are times shown in?', a: 'Western Indonesian Time (WIB). Schedules are set in WIB too. Timestamps stored without a zone are treated as UTC.' },
    { id: 'tour-again', group: 'basics', q: 'Can I take the tour again?', a: 'Yes: **Guide me** in the top bar starts it from the beginning. Close it any time with **End tour** or Esc; it resumes where you left off if you reload the page.' },
    { id: 'missing-screen', group: 'basics', q: 'Why can’t I see a button my colleague has?', a: 'Roles decide what you can do. Viewers and auditors are read-only, operators run but don’t edit pipelines, only admins manage sources and members. Ask a workspace admin to change your role.' },
    { id: 'intranet', group: 'connecting', q: 'Our HR database is only on the company network. Can Nexus reach it?', a: 'Yes, through a **Nexus Agent** installed inside the network. It connects outward to Nexus over HTTPS, so no inbound firewall rule is needed. See *Systems inside your network*.' },
    { id: 'private-refused', group: 'connecting', q: 'Why does Nexus refuse an address like 10.0.0.5 or hr.local?', a: 'Private and intranet addresses can’t be reached from the cloud, and refusing them protects your network. Use a Nexus Agent, or have IT publish the API with a client certificate and Nexus’s fixed outbound IPs.' },
    { id: 'store-passwords', group: 'connecting', q: 'Do we have to store database passwords in Nexus?', a: 'No. Keep them in Vault, AWS Secrets Manager, Azure Key Vault, Google Secret Manager or Doppler and use a `{{secret:…}}` reference. Agent-backed sources keep credentials in the agent’s configuration on your server.' },
    { id: 'write-back', group: 'connecting', q: 'Will Nexus change our source systems?', a: 'Sources are only read. Nexus writes only to data sources you add as destinations, into tables that already exist, and never creates or empties tables there.' },
    { id: 'unsupported', group: 'connecting', q: 'Our system isn’t in the connector list.', a: 'If it has a REST API, use the **REST API** connector: design the requests, paging and sign-in in the form. Databases with a PostgreSQL, MySQL or SQL Server interface work with those connectors. Otherwise export a CSV/Excel file or ask KMPlus for a connector.' },
    { id: 'files-update', group: 'connecting', q: 'How do I update data that comes from an Excel file?', a: 'Upload the new file to the same File Upload source; the next run reads it. For recurring exports, drop them in an S3, Azure Blob or Google Cloud Storage folder and read the folder as one table.' },
    { id: 'draft-publish', group: 'pipelines', q: 'I saved my changes but the pipeline still runs the old way.', a: 'Saving keeps a draft. Runs use the **published** version, so publish the draft (and get it approved, if your workspace requires a second person).' },
    { id: 'run-failed', group: 'pipelines', q: 'A run failed. Where do I start?', a: 'Open the run in **Monitoring** to see the step and message. Configuration problems (wrong password, missing table) don’t retry; fix them and run again. Temporary problems retry from the last checkpoint. **Diagnose with AI** in the editor explains it.' },
    { id: 'incremental', group: 'pipelines', q: 'Does every run read the whole table?', a: 'Not if the source step is **incremental**: Nexus remembers the highest value of a column such as `updated_at` and reads only newer rows. The watermark moves only after the whole run succeeds.' },
    { id: 'duplicates', group: 'pipelines', q: 'Can a retried run create duplicate rows?', a: 'No. Appends are written per chunk with the run id, so a resumed chunk replaces its earlier copy; upserts match on your key columns.' },
    { id: 'chain', group: 'pipelines', q: 'How do I run pipeline B after pipeline A?', a: 'In B’s schedule choose **After another pipeline** and pick A. B is queued each time A finishes.' },
    { id: 'join-multiplied', group: 'pipelines', q: 'Why does my dataset have more rows than the HR system after a Join?', a: 'A Join writes **one row per match**: an employee with two payroll records becomes two rows. The test and the run log say how many rows multiplied. To keep one, set **Several matches** to *First match* and pick the column that decides (e.g. the latest `valid_from`).' },
    { id: 'join-no-match', group: 'pipelines', q: 'Rows were held at a Join with “No match in …”. What now?', a: 'Their key wasn’t found on the Join’s right side (often a unit or record created later, or a key typed differently). Check the key normalization, or wait until the partner exists; then open the row in Data quality and choose **Save & replay**: it re-enters at the Join and is matched again.' },
    { id: 'join-incremental', group: 'pipelines', q: 'Can an incremental pipeline use a Join?', a: 'Yes. The looked-up sources are read in full every run, so new rows of the driver always find their partners. But a change only on the looked-up side (a new salary) reaches an employee only when that employee’s row is read again: use a full read when that matters, or reset the sync position.' },
    { id: 'dedupe-which', group: 'pipelines', q: 'An employee appears twice in the source. Which record is kept?', a: 'Add a **Deduplicate** step on the employee key. By default it keeps the most recent record by a date column such as `updated_at`; you can keep the first or last one read instead. Each removed record is listed in Data quality, naming the one kept. Duplicates across runs are handled by an upsert destination with the same key.' },
    { id: 'aggregate-incremental', group: 'pipelines', q: 'Why can’t an Aggregate read incrementally?', a: 'An incremental read only brings new or changed rows, so a headcount would count just those. Set the sources feeding the Aggregate to **Full**; if they are large, schedule the pipeline less often.' },
    { id: 'api-duplicates', group: 'pipelines', q: 'Can a retried run create an account twice in the other system?', a: 'Not with a **Change data (API)** step: every successful call is recorded by the row’s key before anything else happens, so a retry, a resumed run or a replay skips it. Each call also carries an Idempotency-Key; only an API that ignores that key could, very rarely, see a repeat when Nexus stops right after a call.' },
    { id: 'api-cache', group: 'pipelines', q: 'Why didn’t an Enrich step pick up a change in the API?', a: 'Its answers are cached (24 hours by default). Lower the cache time, or press **Clear cache** in the step; the next run asks the API again.' },
    { id: 'deleted-employees', group: 'pipelines', q: 'How are people who left the company handled?', a: 'With an upsert destination and **Mark rows missing from the source as deleted**, rows that disappear from the source are marked deleted instead of removed. Reads exclude them; the history stays.' },
    { id: 'two-pipelines-one-dataset', group: 'pipelines', q: 'Can two pipelines fill the same dataset?', a: 'Yes, once the dataset has a **defined schema** with key columns: each pipeline maps only its own columns and upserts on the keys, so the others are left alone. The Catalog shows which pipeline fills which column and flags a column two pipelines write (the last run wins).' },
    { id: 'rename-column', group: 'pipelines', q: 'If we rename a dataset column, do API clients break?', a: 'Not right away. Rename it in the dataset’s schema: the Data API keeps serving the old name for 30 days with `Deprecation`, `Sunset` and `X-Nexus-Renamed-Fields` headers, so clients have time to switch. Pipelines, dashboards and masks move to the new name.' },
    { id: 'env-why', group: 'environments', q: 'Why use Development, Staging and Production?', a: 'To change pipelines without risking production data. Build against test data in Development, check the result with production-like data in Staging, and promote only what works to Production, which can’t be edited directly.' },
    { id: 'env-sources', group: 'environments', q: 'Does a promoted pipeline read Development’s database in Production?', a: 'No. Data sources are matched **by name**, and each environment has its own source with its own credentials. Give the source the same name in every environment; a missing one blocks the promotion.' },
    { id: 'env-schedule', group: 'environments', q: 'I promoted a pipeline but it doesn’t run in Production.', a: 'A newly promoted pipeline starts with its **schedule off**; turn it on in Production. If Production requires approvals, the version also waits for a second person first.' },
    { id: 'env-edit-prod', group: 'environments', q: 'Why can’t I edit a pipeline in Production?', a: 'Production is **locked**: pipelines there change only by promotion, so what runs was tested first. Make the change in Development and promote it. An admin can unlock Production in Settings if they must.' },
    { id: 'held-why', group: 'quality', q: 'Why were rows held instead of loaded?', a: 'A validate step or business rule found an error (e.g. an invalid NIK) or the row needs approval. Each held row says which check held it and why.' },
    { id: 'held-fix', group: 'quality', q: 'If I fix a held row, does it skip the remaining checks?', a: 'No. Fixed rows are replayed from the step that held them, so they still pass every later step before they are written.' },
    { id: 'held-rerun', group: 'quality', q: 'What happens to held rows when the pipeline runs again?', a: 'A newer full run replaces older open rows of that pipeline. If the same row is held again, your earlier fix or approval carries over.' },
    { id: 'masking', group: 'access', q: 'Why do I see `••••` in some columns?', a: 'The dataset’s policy masks those columns for your role. Admins and data stewards see real values; the same masks apply in Analytics, AI answers and the Data API.' },
    { id: 'erasure', group: 'access', q: 'How do we handle a deletion request under UU PDP?', a: 'Admins use **Right to erasure** on the Governance screen to remove a person’s records across datasets. The request and its result are recorded in the audit log.' },
    { id: 'lost-2fa', group: 'access', q: 'I lost the phone with my authenticator app.', a: 'Sign in with one of your backup codes, then set up two-factor authentication on the new phone under **Settings → Your account**. If you have no codes left, ask a workspace admin.' },
    { id: 'sso', group: 'access', q: 'Can we sign in with Microsoft Entra ID, Google or Okta?', a: 'Yes. An admin adds the provider under **Settings → Sign-in, SSO & SCIM** (OIDC or SAML 2.0) and verifies your email domain with a DNS record. SCIM can create and deactivate accounts automatically.' },
    { id: 'audit-who', group: 'access', q: 'Can we see who changed a pipeline or viewed salary data?', a: 'Yes: **Settings → Audit log** lists every change (with before and after) and every view of real data, with the person, time, IP address and browser.' },
    { id: 'ai-data', group: 'ai', q: 'Does the AI assistant see our employees’ data?', a: 'No. Prompts carry table and column names and examples from public columns only; personal and masked columns are left out, and check messages are redacted. Answers are drafts you review.' },
    { id: 'ai-model', group: 'ai', q: 'Which AI model does Nexus use?', a: 'Open-source models only, through any OpenAI-compatible server (e.g. Ollama or vLLM): the one configured for Nexus, or one running next to your Nexus Agent so prompts never leave your network. Admins can turn the assistant off.' },
    { id: 'ai-off', group: 'ai', q: 'Does anything stop working without AI?', a: 'No. Connector suggestions and catalog search answer from built-in rules first; the model only adds to them. Pipelines, rules and analytics work fully without it.' },
  ],
  diagrams: {
    workflow: {
      stages: [
        { title: 'Connect', body: 'Connectors and data sources' },
        { title: 'Build', body: 'Pipelines and business rules' },
        { title: 'Operate', body: 'Monitoring and data quality' },
        { title: 'Govern', body: 'Catalog, policies, audit' },
        { title: 'Deliver', body: 'KMPlus products, Analytics, Data API' },
      ],
    },
    architecture: {
      network: 'Your company network',
      cloud: 'KMPlus Nexus (cloud)',
      consumers: 'Where data goes',
      systems: 'HR database, intranet API, MinIO',
      agent: 'Nexus Agent',
      nexus: 'Pipelines · governance · catalog',
      products: 'KMPlus products',
      api: 'Data API · webhooks · Analytics',
      secrets: 'Secrets manager',
      outbound: 'outbound HTTPS only',
      direct: 'cloud apps: SaaS HR, S3, Datadog …',
    },
    pipeline: {
      steps: [
        { title: 'Source', body: 'Talenta employees' },
        { title: 'Map', body: 'to Employee' },
        { title: 'Validate', body: 'NIK, email, dates' },
        { title: 'Rules', body: 'manager approval' },
        { title: 'Destination', body: 'dataset · KMS' },
      ],
      quarantine: 'Quarantine: fix · approve · dismiss',
      replay: 'replay from the step that held them',
    },
    secrets: {
      source: 'Data source (HR database)',
      reference: 'password = {{secret:Vault prod:hr/postgres#password}}',
      manager: 'Vault prod',
      connect: 'value read at connect time, kept ≤ 60 s in memory',
      note: 'never stored · never logged · never sent to the browser',
    },
    environments: {
      stages: [
        { title: 'Development', body: 'Build and test against test data', note: 'editable' },
        { title: 'Staging', body: 'Check with production-like data', note: 'editable' },
        { title: 'Production', body: 'The real HR data and KMPlus products', note: 'locked: changes only by promotion' },
      ],
      promote: 'Promote',
      matches: 'data sources and rules matched by name',
      approval: 'approval if the target requires it',
    },
    roles: {
      permission: 'Permission',
      permissions: {
        'workspace:manage': 'Manage the workspace, members, roles and invites',
        'sources:manage': 'Add, edit and delete data sources',
        'connectors:manage': 'Install and remove connectors',
        'pipelines:edit': 'Create and edit pipelines',
        'pipelines:run': 'Run pipelines and pause schedules',
        'data:preview': 'See data rows (masked)',
        'audit:view': 'Read the audit log',
        'data:unmasked': 'See masked columns unmasked',
        'governance:manage': 'Edit dataset policies',
        'data:erase': 'Erase a person’s records',
        'dashboards:edit': 'Build Analytics dashboards',
        'rules:edit': 'Edit business rules',
        'quality:manage': 'Fix, approve and replay held rows',
        'catalog:edit': 'Document the catalog',
        'api:manage': 'Manage API keys and webhooks',
        'pipelines:approve': 'Approve publishes',
      },
    },
  },
}
