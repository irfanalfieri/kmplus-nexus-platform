/** Identity provider presets for the SSO settings form. Client-safe. */

export const SSO_PRESETS = ['azure', 'google', 'okta', 'oidc'] as const
export type SsoPreset = (typeof SSO_PRESETS)[number]

export const SSO_PRESET_INFO: Record<SsoPreset, { label: string; field: string; placeholder: string; help: string }> = {
  azure: {
    label: 'Microsoft Entra ID (Azure AD)',
    field: 'Directory (tenant) ID',
    placeholder: '72f988bf-86f1-41af-91ab-2d7cd011db47',
    help: 'Entra admin center → App registrations → New registration (Web). Add the redirect URI below, create a client secret, and copy the Application (client) ID and Directory (tenant) ID.',
  },
  google: {
    label: 'Google Workspace',
    field: '',
    placeholder: '',
    help: 'Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application). Add the redirect URI below. Set the consent screen to Internal so only your Workspace users can sign in.',
  },
  okta: {
    label: 'Okta',
    field: 'Okta domain',
    placeholder: 'kmplus.okta.com',
    help: 'Okta admin → Applications → Create App Integration → OIDC, Web Application. Add the redirect URI below as a sign-in redirect URI and assign the people who may sign in.',
  },
  oidc: {
    label: 'Other OpenID Connect provider',
    field: 'Issuer URL',
    placeholder: 'https://login.example.com',
    help: 'Create an OIDC web client with the redirect URI below; the issuer must publish /.well-known/openid-configuration.',
  },
}

/** Issuer URL from the preset and its one field. */
export function issuerFor(preset: SsoPreset, value: string): string {
  const v = value.trim().replace(/\/+$/, '')
  switch (preset) {
    case 'azure':
      return `https://login.microsoftonline.com/${v}/v2.0`
    case 'google':
      return 'https://accounts.google.com'
    case 'okta':
      return `https://${v.replace(/^https?:\/\//, '')}`
    default:
      return v
  }
}

/** Free email providers can't be claimed for SSO: everyone shares them. */
export const PUBLIC_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.id', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'mail.com', 'zoho.com'])

export const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

// ── SAML 2.0 ─────────────────────────────────────────────────────────────────

export const SAML_PRESETS = ['azure', 'okta', 'google', 'saml'] as const
export type SamlPreset = (typeof SAML_PRESETS)[number]

export const SAML_PRESET_INFO: Record<SamlPreset, { label: string; help: string }> = {
  azure: {
    label: 'Microsoft Entra ID (SAML)',
    help: 'Entra admin center → Enterprise applications → New application → Create your own application → Single sign-on → SAML. Enter the Identifier (Entity ID) and Reply URL (ACS) shown after saving, then paste the App Federation Metadata URL.',
  },
  okta: {
    label: 'Okta (SAML)',
    help: 'Okta admin → Applications → Create App Integration → SAML 2.0. Use the ACS URL as "Single sign-on URL" and the Entity ID as "Audience URI"; add attribute statements email, firstName, lastName. Then paste the metadata URL from the Sign On tab.',
  },
  google: {
    label: 'Google Workspace (SAML)',
    help: 'Admin console → Apps → Web and mobile apps → Add custom SAML app. Download the IdP metadata, enter the ACS URL and Entity ID, and map Primary email to "email".',
  },
  saml: {
    label: 'Other SAML 2.0 provider (ADFS, Keycloak, PingFederate …)',
    help: 'Create a SAML 2.0 relying party / client with the ACS URL and Entity ID shown after saving, release the user\'s email (as the NameID or an "email" attribute), and paste the IdP metadata.',
  },
}
