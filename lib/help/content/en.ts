import type { HelpContent } from '../types'

/** The guide in English: the source of truth. id.ts mirrors every id. */
export const helpEn: HelpContent = {
  chapters: [
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
            { kind: 'diagram', diagram: 'workflow', caption: 'The workflow. Every screen in Nexus belongs to one of these stages; the guided tour visits them in this order.' },
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
                ['Workspace', 'Your company’s space: its members, roles, data sources and pipelines. Environments link dev, staging and prod workspaces.'],
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
                '**The bell** lists failed runs and held rows; the **account menu** switches theme (light, dark, system) and language (English, Bahasa Indonesia).',
                'Every screen has its own address, so you can bookmark it or send it to a colleague.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'What you see depends on your role. A control you can’t use is hidden; the server checks every action again, so hiding is a convenience, not the protection.' },
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
                '**Test run** in the editor to see rows flow through each step, then **Publish** and set a schedule.',
                'Watch the first run in **Monitoring**, and fix any held rows in **Data quality**.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'connect',
      title: 'Connect your systems',
      summary: 'Connectors, data sources, the Nexus Agent for your intranet, secrets managers and infrastructure sources.',
      screen: 'sources',
      sections: [
        {
          id: 'connectors',
          title: 'Connectors',
          blocks: [
            { kind: 'shot', screen: 'connectors', caption: 'Connectors grouped by category, with search.' },
            { kind: 'p', text: 'Connectors are grouped as **Applications** (SAP SuccessFactors / HCM, Talenta, Salesforce …), **KMPlus products**, **Databases & warehouses** (PostgreSQL, MySQL, SQL Server, Oracle, Snowflake, Supabase), **APIs** (any REST API), **Files** (CSV and Excel upload), **Infrastructure** (observability and cloud storage), **Identity & directories** (Active Directory / LDAP) and **Secrets managers**. Search matches names and keywords, so “excel” finds file upload and cloud storage.' },
            { kind: 'p', text: 'Installing needs the *install connectors* permission (admins). Connectors marked premium may be billed later; today every connector installs free.' },
          ],
        },
        {
          id: 'sources',
          title: 'Data sources',
          blocks: [
            { kind: 'shot', screen: 'sources', caption: 'Data sources, with what each is used as and when it was last tested.' },
            {
              kind: 'steps',
              items: [
                '**Add source**, pick an installed connector and fill in its sign-in. Password fields can hold a secret reference instead of the password (see Secrets managers).',
                '**Test** checks the connection and scans the tables and columns.',
                'Name it and choose what it is **used as**: a source (Nexus reads), a destination (Nexus writes), or both.',
                '**Browse** a source’s tables and preview sample rows (masked for your role).',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Credentials are encrypted with a key that belongs to your workspace and are never sent back to the browser. When you edit a source, secrets show as masked and stay unchanged unless you type a new one.' },
            { kind: 'p', text: 'Nexus never creates or empties tables in your own databases. It writes only to data sources added as destinations, into tables that already exist.' },
          ],
        },
        {
          id: 'files',
          title: 'Files (CSV and Excel)',
          blocks: [
            { kind: 'p', text: 'A **File Upload** source takes CSV, TSV or XLSX files of up to 50 MB. The file is read in your browser, typed (numbers, dates, true/false), and stored as a table Nexus can read like any other. Upload a new version to the same source and the next run reads it; the **CSV / Excel → Dataset** template turns it into a dataset in one step.' },
          ],
        },
        {
          id: 'agent',
          title: 'Systems inside your network (Nexus Agent)',
          blocks: [
            { kind: 'diagram', diagram: 'architecture', caption: 'The Nexus Agent connects outward to Nexus. Nothing in your network needs to accept a connection from the internet.' },
            { kind: 'p', text: 'Databases and APIs on your intranet (addresses like `10.x`, `192.168.x` or `hr.company.local`) can’t be reached from the cloud, and Nexus refuses them on purpose. Install a **Nexus Agent** on a server inside the network instead: it connects **outward** over HTTPS, picks up work, runs it next to your systems, and returns only the results.' },
            {
              kind: 'steps',
              items: [
                '**Settings → Nexus Agents → New agent**: name it and copy its one-time token.',
                'Download the agent (one file, Node 20 or newer), write `nexus-agent.json` with the token and your connections (passwords can come from environment variables), and run it. `--check` tests the connections first.',
                'Back in Nexus the agent shows as online. **Data sources → Add source → Through an agent** lists its connections.',
              ],
            },
            { kind: 'p', text: 'Intranet REST APIs work the same way: the agent holds the base URL and the sign-in, Nexus sends only the request design. If your IT team prefers to publish the API instead, Nexus can call it directly with a client certificate (mTLS), a company CA and signed requests (`X-Nexus-Signature`) from fixed outbound IP addresses listed under **Network** in the REST form.' },
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
            { kind: 'p', text: 'The **Infrastructure** category reads operational data as tables: **Prometheus** (targets, alerts and your PromQL queries), **Elasticsearch / OpenSearch** (indices, incremental on a date field), **Datadog**, **New Relic**, **Grafana**, and files in **S3-compatible storage** (S3, MinIO, R2 …), **Azure Blob** and **Google Cloud Storage**. A folder of daily exports (`daily/*.csv`) becomes one table, so new files keep feeding the same pipeline.' },
          ],
        },
      ],
    },
    {
      id: 'pipelines',
      title: 'Build pipelines',
      summary: 'Templates, the editor, steps, test runs, publishing, schedules and triggers.',
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
                ['Map', 'Renames and converts columns: trim, case, dates, numbers, hashing, conditional values and lookups into another dataset (e.g. ORG_CODE → org name). Can map to a Unified Data Model entity such as Employee.'],
                ['Validate', 'Checks each row: required, email, phone, NIK, NPWP, unique, ranges, dates, “exists in”, manager hierarchy. Errors hold the row; warnings only note it.'],
                ['Rules', 'Applies business rules from the Rules screen, including rows that must wait for approval.'],
                ['Router', 'Sends rows down different branches by condition.'],
                ['Destination', 'Writes to a dataset (append, upsert by key, or replace) or to a destination data source such as a KMPlus product.'],
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
                '**Test run** reads a sample, runs every step and shows how many rows passed, were changed or held at each one, with the rows themselves (masked for your role).',
                '**Save** keeps a draft; the published version keeps running until you **Publish**. Each publish is a version you can compare and restore.',
                'When a run fails, **Diagnose with AI** asks the AI assistant to explain the failure from the step messages (never the row values) and can suggest a fix as a new draft.',
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
          title: 'Approvals and environments',
          blocks: [
            { kind: 'p', text: 'A workspace can require a **second person to approve** every publish, or only publishes that delete or replace data (**Settings → Approvals & environments**). The request waits under **Approvals** on the Pipelines screen until an admin or steward approves it.' },
            { kind: 'p', text: '**Environments** link workspaces as dev → staging → prod. **Promote** copies the published version of a pipeline to the next environment, matching data sources and rules by name. Production is locked by default: pipelines there change only by promotion.' },
          ],
        },
      ],
    },
    {
      id: 'rules',
      title: 'Business rules',
      summary: 'Checks and decisions reused across pipelines.',
      screen: 'rules',
      sections: [
        {
          id: 'rules-what',
          title: 'Rules in practice',
          blocks: [
            { kind: 'shot', screen: 'rules', caption: 'Business rules with where each is used.' },
            { kind: 'p', text: 'A rule is a condition plus an action: **include** or **exclude** the row, **set** or **calculate** a field, **route** it to a branch, **notify** someone, **require approval** (the row waits in quarantine for a second person), or **trigger** another pipeline. Conditions use the same builder as filters, with expressions such as `days_between(start_date, today())`.' },
            { kind: 'p', text: 'Rules are shared: change a rule once and every pipeline that uses it applies the new version on its next run. Edits are recorded in the audit log.' },
          ],
        },
      ],
    },
    {
      id: 'monitoring',
      title: 'Monitor runs',
      summary: 'Runs, schedules, the worker, alerts and webhooks.',
      screen: 'monitoring',
      sections: [
        {
          id: 'runs',
          title: 'Runs and the worker',
          blocks: [
            { kind: 'shot', screen: 'monitoring', caption: 'Monitoring: health of the worker and scheduler, then every run.' },
            {
              kind: 'list',
              items: [
                'Each run shows its trigger, duration, rows read, written and held, and its steps.',
                '**Cancel** a queued or running job; **Retry** a finished run (it resumes from the last checkpoint).',
                'A failed run creates a notification (the bell) and an email to the people who should know; a pipeline can also alert on held rows.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'quality',
      title: 'Data quality',
      summary: 'The quarantine inbox: fix, approve, dismiss and replay held rows.',
      screen: 'quality',
      sections: [
        {
          id: 'inbox',
          title: 'The quarantine inbox',
          blocks: [
            { kind: 'shot', screen: 'quality', caption: 'Held rows grouped by pipeline and check, with the reason for each.' },
            {
              kind: 'steps',
              items: [
                'Open a group to see the held rows and why each was held.',
                '**Fix** a value in place, **Approve** a row waiting for approval, or **Dismiss** a row that should not move.',
                '**Send on**: Nexus replays the fixed rows from the step that held them, so they still pass every later check.',
              ],
            },
            { kind: 'p', text: 'A newer full run replaces older open rows of the same pipeline; fixes and approvals carry over to identical rows. Quality scores per dataset are recorded daily so you can see the trend.' },
          ],
        },
      ],
    },
    {
      id: 'catalog',
      title: 'Catalog and lineage',
      summary: 'Find any dataset or source table, document it, and see where it comes from.',
      screen: 'catalog',
      sections: [
        {
          id: 'catalog-use',
          title: 'Using the catalog',
          blocks: [
            { kind: 'shot', screen: 'catalog', caption: 'The catalog: datasets and source tables with owners, tags and documentation.' },
            {
              kind: 'list',
              items: [
                '**Search in plain words.** “Employees who joined last month” finds tables by name, documentation and column names (never row values).',
                '**Lineage** draws which pipelines read and write each dataset, back to the source tables.',
                'Stewards add owners, tags and descriptions, and choose **live** (query the source each time) or **cached** (a managed pipeline keeps a copy) for source tables.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'governance',
      title: 'Governance and privacy',
      summary: 'Classification, masking, row filters, retention and erasure (UU PDP).',
      screen: 'governance',
      sections: [
        {
          id: 'policies',
          title: 'Dataset policies',
          blocks: [
            { kind: 'shot', screen: 'governance', caption: 'Governance: dataset policies with classified and masked columns.' },
            {
              kind: 'list',
              items: [
                '**Classify** each column as public, internal, personal or sensitive. Nexus suggests a class and mask for common HR columns such as NIK, NPWP, salary and phone.',
                '**Mask** columns for roles without unmasked access: hide the value, keep the last four characters (`••••0001`), or replace it with a stable pseudonym (hash) so counts and joins still line up.',
                '**Row filters per role** limit which rows a role sees, e.g. viewers only their business unit.',
                '**Retention** deletes rows older than a period, checked hourly.',
                '**Right to erasure** removes one person’s records across datasets, recorded in the audit log.',
              ],
            },
            { kind: 'note', tone: 'info', text: 'Masks and row filters apply everywhere data is shown: dataset previews, the catalog, Analytics, AI answers and the Data API. Admins and data stewards see real values.' },
          ],
        },
      ],
    },
    {
      id: 'analytics',
      title: 'Analytics',
      summary: 'Dashboards and plain-language questions over your datasets.',
      screen: 'analytics',
      sections: [
        {
          id: 'dashboards',
          title: 'Dashboards and questions',
          blocks: [
            { kind: 'shot', screen: 'analytics', caption: 'Analytics: dashboards built from datasets.' },
            {
              kind: 'list',
              items: [
                'A dashboard is a set of widgets: a number, a bar or line chart, or a table, each over one dataset with filters, a grouping (also by day, week, month, quarter or year) and a measure (count, distinct count, sum, average, min, max).',
                '**Ask a question** in words (“headcount by department this year”) and the assistant drafts a widget you can keep or change.',
                'Every chart has a table view. Queries are read-only, time out after 15 seconds, and respect your masks and row filters.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'api',
      title: 'Data API and webhooks',
      summary: 'Read datasets from other systems and get told when things happen.',
      screen: 'settings',
      sections: [
        {
          id: 'data-api',
          title: 'Data API',
          blocks: [
            { kind: 'p', text: 'Create a key under **Settings → API keys** with the scopes it needs (`datasets:read`, `domains:read`, `pipelines:run`, `runs:read`) and a role; the key reads as that role, with its masks and row filters. The key is shown once; Nexus keeps only a hash.' },
            { kind: 'code', text: 'curl -H "Authorization: Bearer nxk_…" https://<your-nexus>/api/v1/datasets/employees?limit=100' },
            { kind: 'p', text: 'The full reference is at `/api/v1/openapi.json`. Responses carry rate-limit headers; every read is recorded in the audit log.' },
          ],
        },
        {
          id: 'webhooks',
          title: 'Webhooks',
          blocks: [
            { kind: 'p', text: '**Settings → Webhooks** sends signed events (`run.succeeded`, `run.failed`, `dataset.updated`) to your HTTPS endpoint. Verify the signature with the signing secret; failed deliveries are retried.' },
          ],
        },
      ],
    },
    {
      id: 'kmplus',
      title: 'KMPlus products',
      summary: 'Sending data into KMS, LMS, TMS, PMS, CMS and IMS.',
      sections: [
        {
          id: 'ingest',
          title: 'The Ingest Contract',
          blocks: [
            { kind: 'p', text: 'KMPlus products are destinations. Add the product as a data source (its URL and token), then end a pipeline with a destination step that writes to it. Nexus sends records through the **Nexus Ingest Contract**; records the product refuses are held in the quarantine at the destination step with the product’s reason, so you can fix and resend them.' },
          ],
        },
      ],
    },
    {
      id: 'admin',
      title: 'Administer the workspace',
      summary: 'Members and roles, sign-in and SSO, environments, agents, AI, audit.',
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
          id: 'settings-tabs',
          title: 'Settings',
          blocks: [
            { kind: 'shot', screen: 'settings', caption: 'Settings, with a tab per area.' },
            {
              kind: 'table',
              head: ['Tab', 'What you manage'],
              rows: [
                ['General', 'The workspace name.'],
                ['Members & roles', 'Invite people, change roles, remove members.'],
                ['Your account', 'Your own two-factor authentication and backup codes.'],
                ['Sign-in, SSO & SCIM', 'Single sign-on (OIDC or SAML: Entra ID, Google, Okta …) with verified domains, and SCIM provisioning.'],
                ['Approvals & environments', 'Whether publishes need a second person; link dev, staging and prod workspaces; lock production.'],
                ['Nexus Agents', 'Agents in your network and their status.'],
                ['AI assistant', 'Which open-source model the assistant uses: the server’s, one next to an agent, or off.'],
                ['API keys · Webhooks', 'Data API keys and outbound webhooks.'],
                ['Audit log', 'Every change and every view of real data, with who, when and from where.'],
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'security',
      title: 'Security',
      summary: 'How Nexus protects accounts, credentials and data.',
      sections: [
        {
          id: 'security-facts',
          title: 'What is protected, and how',
          blocks: [
            {
              kind: 'list',
              items: [
                '**Every account uses two-factor authentication** (an authenticator app), unless it signs in through your company’s SSO.',
                '**Credentials** are encrypted with AES-256-GCM using a key derived for your workspace, and never returned to the browser or written to logs.',
                '**Network**: connector requests from the cloud refuse private and intranet addresses; webhooks and SSO discovery accept only public HTTPS.',
                '**Audit**: sign-ins, every change and every view of real data are recorded with IP address and browser.',
                '**AI** uses open-source models only. Prompts carry column names and examples from public columns, never personal data.',
              ],
            },
          ],
        },
      ],
    },
  ],
  faqGroups: [
    { id: 'basics', title: 'Basics' },
    { id: 'connecting', title: 'Connecting systems' },
    { id: 'pipelines', title: 'Pipelines and runs' },
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
    { id: 'chain', group: 'pipelines', q: 'How do I run pipeline B after pipeline A?', a: 'In B’s schedule choose **After another pipeline** and pick A. B is queued each time A finishes successfully.' },
    { id: 'deleted-employees', group: 'pipelines', q: 'How are people who left the company handled?', a: 'With an upsert destination and **mark missing rows deleted**, rows that disappear from the source are marked deleted instead of removed. Reads exclude them; the history stays.' },
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
