import { cookies } from 'next/headers'
import {
  credentialsFromOAuthResult,
  exchangeSalesforceCode,
  parseSalesforceLoginHost,
  verifyOAuthState,
} from '@/lib/connectors/salesforce/oauth'

function htmlPage(title: string, body: string) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title></head><body style="font-family:system-ui;padding:2rem">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    const message = errorDescription ?? error
    return htmlPage(
      'Salesforce connection failed',
      `<p>Authorization failed: ${message}</p><script>if(window.opener){window.opener.postMessage({type:'kmplus:salesforce-oauth',ok:false,message:${JSON.stringify(message)}},window.location.origin);setTimeout(()=>window.close(),1500);}</script>`
    )
  }

  if (!code || !state) {
    return htmlPage('Salesforce connection failed', '<p>Missing authorization code or state.</p>')
  }

  const cookieStore = await cookies()
  const pending = cookieStore.get('sf_oauth_pending')?.value
  if (!pending) {
    return htmlPage('Salesforce connection failed', '<p>OAuth session expired. Try connecting again.</p>')
  }

  const payload = verifyOAuthState(pending)
  if (!payload || payload.nonce !== state) {
    return htmlPage('Salesforce connection failed', '<p>Invalid OAuth state.</p>')
  }

  const exp = typeof payload.exp === 'number' ? payload.exp : 0
  if (Date.now() > exp) {
    return htmlPage('Salesforce connection failed', '<p>OAuth session timed out. Try connecting again.</p>')
  }

  const clientId = String(payload.clientId ?? '')
  const clientSecret = String(payload.clientSecret ?? '')
  const loginHost = parseSalesforceLoginHost(String(payload.loginHost ?? 'login'))

  try {
    const tokens = await exchangeSalesforceCode({ code, clientId, clientSecret, loginHost })
    cookieStore.delete('sf_oauth_pending')

    const credentials = credentialsFromOAuthResult(
      { authMethod: 'web_oauth', clientId, clientSecret, loginHost },
      tokens
    )

    const payloadJson = JSON.stringify({
      ok: true,
      credentials: {
        authMethod: 'web_oauth',
        clientId,
        clientSecret,
        loginHost,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        instanceUrl: credentials.instanceUrl,
        connectedAt: credentials.connectedAt,
      },
      instanceUrl: tokens.instance_url,
    })

    return htmlPage(
      'Salesforce connected',
      `<p>Salesforce connected successfully. This window will close…</p>
<script>
(function(){
  var data = ${payloadJson};
  if (window.opener) {
    window.opener.postMessage({ type: 'kmplus:salesforce-oauth', ...data }, window.location.origin);
    window.close();
  }
})();
</script>`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token exchange failed'
    return htmlPage(
      'Salesforce connection failed',
      `<p>${message}</p><script>if(window.opener){window.opener.postMessage({type:'kmplus:salesforce-oauth',ok:false,message:${JSON.stringify(message)}},window.location.origin);setTimeout(()=>window.close(),2000);}</script>`
    )
  }
}
