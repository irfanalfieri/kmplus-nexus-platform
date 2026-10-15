import { NextResponse, type NextRequest } from 'next/server'

/**
 * Tells the dashboard layout which page was asked for (x-nexus-path), so the
 * sign-in, Terms and Conditions and 2FA gates can send people back to it.
 * Layouts can't read the URL themselves.
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl
  const params = new URLSearchParams(url.search)
  params.delete('_rsc')
  const query = params.toString()
  const headers = new Headers(request.headers)
  headers.set('x-nexus-path', `${url.pathname}${query ? `?${query}` : ''}`)
  return NextResponse.next({ request: { headers } })
}

export const config = { matcher: ['/dashboard/:path*'] }
