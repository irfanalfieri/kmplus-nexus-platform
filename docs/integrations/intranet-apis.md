# Intranet APIs: connecting KMPlus Nexus to APIs inside a company network

Many HR, ERP and identity systems expose an API that only exists inside the company network: `http://hr-api.corp.local/v1`, `https://10.20.0.15:8443/odata`, an on-premises KMPlus product. KMPlus Nexus runs in the cloud, so it cannot open a connection to such an address by itself, and it refuses to try: a cloud service that calls private addresses on request is a security hole (server-side request forgery).

There are three ways to connect one. Pick per API.

| | **A. Nexus Agent** (recommended) | **B. Publish the API for Nexus** (manual) | **C. Self-hosted Nexus** |
|---|---|---|---|
| What runs where | A small program in your network connects **out** to Nexus over HTTPS and calls the API for it | Your network team exposes the API on an https address through a gateway that admits only Nexus | Nexus itself runs inside your network |
| Firewall change | None (outbound HTTPS 443 only) | Inbound rule on the gateway | None |
| Where secrets live | Agent's config file (Nexus never sees the API token) | Nexus (encrypted per workspace) | Nexus |
| How Nexus proves it is Nexus | Agent token (`nxa_…`) | Client certificate (mTLS) and/or signed requests; IP allow-list only when Nexus has fixed outbound IPs | n/a |
| Good for | Most companies; locked-down networks; government, banking | Companies that already publish partner APIs through an API gateway / WAF | Air-gapped or on-premises installs |

Nexus helps you choose: if you enter a private or intranet address in a REST, SAP, Talenta or KMPlus product data source, the connection test answers that the address is inside a private network and points to the Nexus Agent. The REST data source's **Network** tab explains options A and B and holds the settings for B.

---

## A. Through a Nexus Agent

The agent is described in [agent/README.md](../../agent/README.md). For an intranet API, add a `rest` connection with **only the address and the sign-in**:

```json
{
  "url": "https://kmplus-nexus-platform.vercel.app",
  "token": "nxa_…",
  "connections": [
    {
      "name": "HR API",
      "type": "rest",
      "credentials": {
        "baseUrl": "http://hr-api.corp.local/v1",
        "authMethod": "bearer",
        "bearerToken": "${HR_API_TOKEN}"
      }
    }
  ]
}
```

Supported sign-in fields are the REST connector's: `authMethod` = `none`, `bearer` (`bearerToken`, `bearerPrefix`), `api_key` (`apiKeyHeader`, `apiKeyValue`, `apiKeyLocation`), `basic` (`basicUsername`, `basicPassword`), `custom_header` (`customHeaderName`, `customHeaderValue`), `oauth2_client_credentials` / `oauth2_password` (`oauthTokenUrl`, `oauthClientId`, `oauthClientSecret`, `oauthScope`, `oauthUsername`, `oauthPassword`). An internal TLS certificate can be trusted with `caCert` (PEM); a gateway that wants a client certificate gets `clientCert` + `clientKey`.

Then, in Nexus:

1. **Settings → Nexus Agents**: the connection shows as *intranet API (REST)* with its address. Click **Add as source**.
2. **Data sources → ⋯ → Edit credentials** on the new source: design the request as in any REST source (resource path, method, parameters, headers, body, data path, paging) and **Send** to try it. The request goes through the agent. **Test & save** stores it.
3. Use the source in pipelines, the catalog and live queries like any other.

What the agent guarantees (agent 1.2.0 or later):

- The base URL, sign-in, certificates and variables come **only** from the agent's config. A request from Nexus can't change them.
- Every request must stay under the base URL: same scheme, host and port, and a path at or below the base path (`/v1/…`). `..` tricks and other hosts are refused before anything is sent.
- Redirects are not followed.
- Nexus stores only the request design (encrypted); the API token never leaves your network.
- One connection serves many data sources (one per endpoint), and changing an endpoint doesn't need an agent restart.

**Writing to an intranet API (agent 1.3.0 or later).** Set `"writable": true` on the `rest` connection and add it as a destination. A pipeline's Destination step designs the write request (method, path with `{{column}}` values, a body built from a pasted JSON / form / XML example); the agent renders and sends it with the same guarantees as above (its own base URL and sign-in, requests under the base URL, no redirects), honours the step's rate limit and Retry-After, and reports refused rows back to Nexus's quarantine. Nexus refuses to send writes to an older agent.

An agent older than 1.2.0 can still serve an intranet API whose complete request is in its config (`resourcePath`, `dataPath`, paging fields next to `baseUrl`), but Nexus refuses to send it designed requests until it is updated.

---

## B. Publish the API for Nexus (manual)

Your network team exposes the intranet API on an **https** address that Nexus can reach, through something you already run: a reverse proxy (nginx, HAProxy, IIS ARR), a WAF (F5, FortiWeb, Cloudflare), an API gateway (Kong, Azure API Management, AWS API Gateway, Apigee) or a VPN/tunnel endpoint. The gateway must let **only Nexus** in. Nexus supports three ways to prove it is Nexus; use at least one of the first two.

Enter the published address as the REST data source's **Base URL** and fill in the **Network** tab.

### 1. Client certificate (mutual TLS) — strongest

1. Issue a client certificate for Nexus from your company CA (CN e.g. `kmplus-nexus`).
2. In the data source → **Network** → *Client certificate*, paste the certificate (PEM) and its private key (PEM). The key is stored encrypted and shown masked afterwards.
3. Configure the gateway to require a client certificate signed by that CA.

nginx example:

```nginx
server {
    listen 443 ssl;
    server_name hr-api.partner.example.co.id;

    ssl_certificate         /etc/nginx/tls/hr-api.crt;
    ssl_certificate_key     /etc/nginx/tls/hr-api.key;

    # Only clients with a certificate from the company CA, and only the one issued to Nexus.
    ssl_client_certificate  /etc/nginx/tls/company-ca.crt;
    ssl_verify_client       on;
    if ($ssl_client_s_dn !~ "CN=kmplus-nexus") { return 403; }

    location /v1/ {
        proxy_pass http://hr-api.corp.local/v1/;
    }
}
```

If the gateway's own server certificate comes from your company CA (not a public CA), paste that CA under *Company CA certificate*. Nexus then verifies the gateway against it. Certificate verification is never switched off.

### 2. Signed requests

In **Network** → *Signed requests*, click **Generate**, copy the secret and give it to your network team (after saving it is shown masked). Every request Nexus sends then carries:

```
X-Nexus-Timestamp: 1791861000
X-Nexus-Signature: v1=5f0c…   (hex HMAC-SHA256)
```

The signature is `HMAC-SHA256(secret, "<timestamp>.<METHOD>.<path and query>.<hex SHA-256 of the body>")`, for example `1791861000.GET./v1/employees?page=2.e3b0c442…` (the SHA-256 of an empty body). The gateway recomputes it, compares in constant time, and rejects requests older than 5 minutes. Reference implementation: `verifyRequestSignature()` in `lib/net/request-signing.ts`. A Node.js check in front of the API:

```js
const crypto = require('node:crypto')

function nexusSigned(req, rawBody, secret) {
  const ts = req.headers['x-nexus-timestamp']
  const sig = req.headers['x-nexus-signature'] || ''
  if (!/^\d+$/.test(ts || '') || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const bodyHash = crypto.createHash('sha256').update(rawBody || '').digest('hex')
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${req.method}.${req.url}.${bodyHash}`).digest('hex')
  return sig.length === expected.length + 3 && crypto.timingSafeEqual(Buffer.from(sig.slice(3)), Buffer.from(expected))
}
```

`req.url` must be the path and query as Nexus sent them (before the gateway rewrites them). Most API gateways can run this as a policy (Azure APIM `validate-content`/policy expression, Kong `pre-function`, nginx `njs`).

### 3. Outbound IP allow-list

The **Network** tab lists the IP addresses Nexus connects from **when this deployment has fixed ones** (the operator sets `NEXUS_EGRESS_IPS`, for example with a static-IP egress add-on). The standard cloud deployment does **not** have fixed outbound IPs; the tab says so. Don't rely on an IP allow-list alone; combine it with a client certificate or signed requests.

### Checklist for the network team

- [ ] Published on **https** with a valid certificate (public CA, or company CA pasted in Nexus).
- [ ] Only the paths Nexus needs are routed (`/v1/employees`, not the whole server).
- [ ] Client certificate required and/or signature checked; everything else gets 401/403.
- [ ] Rate limit and logging on the gateway.
- [ ] The API's own sign-in (token, OAuth) still configured in the data source's **Authorization** tab.

---

## C. Self-hosted Nexus

A Nexus installed inside your network may call private addresses directly: set `NEXUS_PRIVATE_NETWORK_ACCESS=true` in its environment. This also allows private addresses for webhooks and SSO metadata. Never set it on a Nexus that runs in a shared cloud.

---

## Troubleshooting

| Message | Meaning |
|---|---|
| `… is inside a private network, so KMPlus Nexus can't reach it from the cloud` | The address is private or an intranet name. Use an agent (A) or publish it (B). |
| `… could not be found in public DNS` | The name only resolves inside your network. Same as above. |
| `The request leaves the API's base URL (…)` | Through an agent, the resource path points outside the agent's `baseUrl`. Fix the path, or widen `baseUrl` in the agent's config. |
| `Nexus Agent "…" runs version 1.1.0; intranet API requests designed in Nexus need version 1.2.0` | Download the new agent (Settings → Nexus Agents) and restart it. |
| `self-signed certificate in certificate chain` | The gateway's certificate comes from a CA Nexus doesn't know: paste it under *Company CA certificate*. |
| `other side closed` / `socket hang up` right away | The gateway requires a client certificate and didn't get an accepted one. |
| HTTP 401 from the gateway | Signature missing or wrong: check the secret, the gateway's clock (±5 minutes) and that it checks the original path. |
