'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { KmLogo } from '@/components/brand/km-logo'

/**
 * The frame of every sign-in screen: the board, the KM+ wordmark with "Nexus"
 * above, and one flat panel holding the form.
 */
export function AuthShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        aria-label="KMPlus Nexus home"
      >
        <KmLogo className="h-9" priority />
        <span className="text-base font-semibold tracking-tight" aria-hidden>
          Nexus
        </span>
      </Link>
      <section className={cn('w-full max-w-sm rounded-lg border border-border bg-card p-6', className)}>{children}</section>
    </main>
  )
}

export function AuthForm({ mode, next = '/dashboard', ssoError }: { mode: 'sign-in' | 'sign-up'; next?: string; ssoError?: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(ssoError ? `Single sign-on failed: ${ssoError}` : null)
  const [useSso, setUseSso] = useState(Boolean(ssoError))
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const isSignUp = mode === 'sign-up'

  /** SSO: the email's domain picks the workspace identity provider; the browser goes there and comes back signed in. */
  const signInWithSso = async () => {
    const { data, error } = await authClient.signIn.sso({ email, callbackURL: next, errorCallbackURL: `/sign-in?next=${encodeURIComponent(next)}` })
    setLoading(false)
    if (error)
      return setError(
        error.status === 404 || /not found|no provider/i.test(error.message ?? '')
          ? "Your organization hasn't set up single sign-on for this email domain. Sign in with your password."
          : (error.message ?? 'Single sign-on failed'),
      )
    if (data?.url) window.location.href = data.url
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    if (!isSignUp && useSso) return signInWithSso()

    const setupPath = `/setup-2fa?next=${encodeURIComponent(next)}`
    if (isSignUp) {
      // The verification link signs the user in and continues to 2FA setup.
      const { data, error } = await authClient.signUp.email({ email, password, name, callbackURL: setupPath })
      setLoading(false)
      if (error) return setError(error.message ?? 'Something went wrong')
      if (data?.token) {
        // Email verification is off (production without SMTP): straight to 2FA setup.
        router.push(setupPath)
        return
      }
      setSentTo(email)
      return
    }

    const { data, error } = await authClient.signIn.email({ email, password, callbackURL: setupPath })
    setLoading(false)
    if (error) {
      if (error.code === 'EMAIL_NOT_VERIFIED') {
        setSentTo(email)
        return
      }
      return setError(error.message ?? 'Something went wrong')
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      router.push(`/verify-2fa?next=${encodeURIComponent(next)}`)
      return
    }
    // No 2FA yet: the dashboard sends the user to /setup-2fa.
    router.push(next)
    router.refresh()
  }

  if (sentTo) {
    return (
      <AuthShell className="space-y-3">
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to confirm your address, then set up two-factor authentication with an authenticator app.
        </p>
        <p className="text-xs text-muted-foreground">The link works for 24 hours. Nothing arrived? Check spam, or sign in again to get a new link.</p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setSentTo(null)
            setPassword('')
          }}
        >
          Back to sign in
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{isSignUp ? 'Create an account' : 'Welcome back'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{isSignUp ? 'Sign up to get started' : 'Sign in to your account to continue'}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {isSignUp && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </div>
        {!useSso && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </div>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        <Button type="submit" size="lg" disabled={loading} className="w-full">
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {loading ? 'Please wait...' : isSignUp ? 'Create account' : useSso ? 'Continue with SSO' : 'Sign in'}
        </Button>
        {!isSignUp && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              setUseSso(!useSso)
              setError(null)
            }}
          >
            {useSso ? 'Sign in with a password instead' : 'Sign in with SSO (Microsoft, Google, Okta)'}
          </Button>
        )}
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
        <Link
          href={`${isSignUp ? '/sign-in' : '/sign-up'}${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`}
          className="font-medium text-info-text underline-offset-4 hover:underline"
        >
          {isSignUp ? 'Sign in' : 'Sign up'}
        </Link>
      </p>
    </AuthShell>
  )
}
