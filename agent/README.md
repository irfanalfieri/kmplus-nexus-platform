# KMPlus Nexus Agent

The Nexus Agent lets KMPlus Nexus read from and write to systems inside a private network (HR databases, SAP, Active Directory, intranet APIs) without opening any inbound firewall port. It can also run an open-source AI model next to the data for the AI assistant.

```
  your network                                   internet
┌─────────────────────────────────┐          ┌──────────────────┐
│ HR DB ◄── Nexus Agent ──────────┼── HTTPS ─►  KMPlus Nexus     │
│ SAP   ◄──   (Node 20+)          │ outbound │  (tasks + results)│
│ Ollama ◄─┘                      │   only   └──────────────────┘
└─────────────────────────────────┘
```

- **Outbound only.** The agent polls Nexus over HTTPS (`/api/agent/v1/tasks`, long poll). Nothing connects to it.
- **Credentials stay with you.** Connection passwords live in the agent's config, preferably as environment variables. Nexus only knows each connection's name and type.
- **Limited operations.** Nexus can ask for: a connection test, a schema scan, a sample, reading a table in pages, writing rows and marking rows missing from the source deleted (only on connections you mark `"writable": true`), and an AI completion. There is no "run any SQL" operation. Table and column names are quoted; values are bound.
- **Same code as Nexus.** The agent bundles Nexus's own connector drivers, so reads behave exactly like direct connections.

## Install

1. In Nexus: **Settings → Nexus Agents → Create agent**. Copy the config it shows (it contains the agent token, shown once).
2. Download `nexus-agent.mjs` (**Download agent**, or `https://<your-nexus>/downloads/nexus-agent.mjs`) to a server in your network with Node.js 20 or later.
3. Save the config as `nexus-agent.json` next to it and fill in your connections (see below).
4. Check the connections locally: `node nexus-agent.mjs --config nexus-agent.json --check`
5. Run it: `node nexus-agent.mjs --config nexus-agent.json`. The agent turns green in Settings and lists its connections.
6. In Settings, click **Add as source** (or **Add as destination**) on a connection, then **Test** it under Data Sources. From there it works like any other data source: pipelines, catalog, live queries.

Keep it running as a service: systemd (`ExecStart=/usr/bin/node /opt/nexus-agent/nexus-agent.mjs --config /opt/nexus-agent/nexus-agent.json`, `Restart=always`), a Windows service (e.g. NSSM), or Docker (below).

## Config

```json
{
  "url": "https://kmplus-nexus-platform.vercel.app",
  "token": "nxa_…",
  "connections": [
    { "name": "HR database", "type": "postgres", "credentials": { "connectionString": "${HR_DB_URL}", "schema": "public" } },
    { "name": "Payroll", "type": "mysql", "writable": true, "credentials": { "host": "10.0.0.12", "port": "3306", "username": "nexus", "password": "${PAYROLL_PASSWORD}", "database": "payroll" } },
    { "name": "SAP HCM", "type": "sap", "credentials": { "baseUrl": "https://sap.internal/sap/opu/odata/sap/ZHR_SRV", "username": "NEXUS", "password": "${SAP_PASSWORD}" } },
    { "name": "HR API", "type": "rest", "credentials": { "baseUrl": "http://hr-api.corp.local/v1", "authMethod": "bearer", "bearerToken": "${HR_API_TOKEN}" } }
  ],
  "ai": { "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5:7b-instruct" },
  "concurrency": 4
}
```

- `${NAME}` anywhere in the file is replaced by the environment variable `NAME`; the agent refuses to start if one is missing.
- `type` is a Nexus connector: `postgres`, `mysql`, `oracle`, `snowflake`, `sap`, `ldap`, `rest`, `talenta`, `supabase`, `kmplus`. `credentials` uses the same fields as the connector's form in Nexus.
- `writable` (default `false`): allow pipelines to write to it. Nexus never creates or truncates tables.
- Connections may use private and intranet addresses (`10.x`, `hr-api.corp.local`, plain `http://`): that is what the agent is for. Nexus in the cloud refuses them for direct connections.

## Intranet APIs (agent 1.2.0+)

A `rest` connection holds only the API's address and sign-in (`baseUrl`, `authMethod` and its secret fields; optionally `caCert`, `clientCert`, `clientKey`). The request itself (path, method, parameters, headers, body, data path, paging) is designed in Nexus: **Add as source**, then **Data sources → Edit credentials** on it, and **Send** to try it through the agent. One connection can serve several data sources, and changing an endpoint needs no restart.

The agent always uses its own base URL and sign-in (a request from Nexus can't change them), keeps every request under the base URL (same host and port, path at or below the base path), and doesn't follow redirects. Full guide, including publishing an API for Nexus without an agent: [docs/integrations/intranet-apis.md](../docs/integrations/intranet-apis.md).
- Oracle and Snowflake need their driver next to the agent: `npm install oracledb` or `npm install snowflake-sdk` in the agent's folder.
- `ai` (optional): any OpenAI-compatible server with an open-source model. With [Ollama](https://ollama.com): `ollama pull qwen2.5:7b-instruct`, then use `http://localhost:11434/v1`. In Nexus, choose **Settings → AI assistant → Model next to an agent**. Prompts with your column names and masked samples then never leave your network.

## Docker

```bash
docker build -t nexus-agent -f Dockerfile .
```

```bash
docker run -d --restart=always --name nexus-agent -v /etc/nexus-agent:/config -e HR_DB_URL=postgres://… nexus-agent
```

The image expects `nexus-agent.mjs` next to the Dockerfile and the config at `/config/nexus-agent.json`.

## Operations

- **Logs** show each task's operation, connection, duration and outcome. Data and credentials are never logged.
- **Offline**: Nexus marks the agent offline after 90 seconds without a poll. Pipeline runs that need it fail with "agent offline" and retry like any network error.
- **Rotate the token**: create a new agent in Settings, update the config, restart, then revoke the old agent.
- **Network**: allow outbound HTTPS (443) to the Nexus host. The agent uses Node's built-in fetch; behind an HTTP proxy, use a Node.js release that supports `HTTPS_PROXY` with `NODE_USE_ENV_PROXY=1` (check your version's docs), or allow the agent host direct outbound access.
