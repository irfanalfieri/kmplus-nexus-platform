import { NextResponse, type NextRequest } from 'next/server'

/**
 * Tells the dashboard layout which page was asked for (x-nexus-path), so the
 * sign-in, Terms and Conditions and 2FA gates can send people back to it.
 * Layouts can't read the URL themselves.
 */
export async function proxy(request: NextRequest) {
  const url = request.nextUrl
  if (url.pathname.startsWith('/embed/dashboards/')) return embedHeaders(url.pathname.split('/')[3] ?? '')
  const params = new URLSearchParams(url.search)
  params.delete('_rsc')
  const query = params.toString()
  const headers = new Headers(request.headers)
  headers.set('x-nexus-path', `${url.pathname}${query ? `?${query}` : ''}`)
  return NextResponse.next({ request: { headers } })
}

/**
 * DB-5: an embedded dashboard may only be framed by the sites its link allows
 * (CSP frame-ancestors); the secret URL is never sent on as a referrer.
 */
async function embedHeaders(token: string) {
  const { loadEmbed } = await import('@/lib/analytics/dashboards')
  const { embedCsp } = await import('@/lib/analytics/sharing')
  const found = await loadEmbed(token).catch(() => null)
  const res = NextResponse.next()
  res.headers.set('Content-Security-Policy', embedCsp(found?.embed.allowedOrigins ?? []))
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export const config = { matcher: ['/dashboard/:path*', '/embed/:path*'] }
