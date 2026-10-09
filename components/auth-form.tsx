'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'

export function AuthForm({ mode, next = '/dashboard' }: { mode: 'sign-in' | 'sign-up'; next?: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const isSignUp = mode === 'sign-up'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

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
      <main className="min-h-svh bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-sm p-6 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to <span className="font-medium text-foreground">{sentTo}</span>. Open it to confirm your address, then set up two-factor authentication with an authenticator app.
          </p>
          <p className="text-xs text-muted-foreground">The link works for 24 hours. Nothing arrived? Check spam, or sign in again to get a new link.</p>
          <Button variant="outline" className="w-full" onClick={() => { setSentTo(null); setPassword('') }}>
            Back to sign in
          </Button>
        </Card>
      </main>
    )
  }

  return (
    <main className="min-h-svh bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {isSignUp ? 'Create an account' : 'Welcome back'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isSignUp
              ? 'Sign up to get started'
              : 'Sign in to your account to continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {isSignUp && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
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

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading
              ? 'Please wait...'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
          </Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-6">
          {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          <Link
            href={`${isSignUp ? '/sign-in' : '/sign-up'}${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            {isSignUp ? 'Sign in' : 'Sign up'}
          </Link>
        </p>
      </Card>
    </main>
  )
}
