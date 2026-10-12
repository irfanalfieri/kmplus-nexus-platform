'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LOCALE_COOKIE, LOCALE_INFO, THEME_COOKIE, type Locale, type Theme } from '@/lib/i18n/config'
import { createTranslator, type Translate } from '@/lib/i18n/translate'

interface Prefs {
  locale: Locale
  theme: Theme
  t: Translate
  setLocale: (locale: Locale) => void
  setTheme: (theme: Theme) => void
  /** Dates and numbers in the interface language, always in WIB unless a zone is given. */
  formatDateTime: (value: string | number | Date, opts?: Intl.DateTimeFormatOptions) => string
  formatNumber: (value: number) => string
}

const PrefsCtx = createContext<Prefs | null>(null)
const YEAR = 365 * 24 * 60 * 60

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR}; samesite=lax`
}

/** Applies the theme to <html> immediately; the cookie makes the server agree on the next request. */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (theme !== 'system') root.classList.add(theme)
}

export function PrefsProvider({ locale: initialLocale, theme: initialTheme, children }: { locale: Locale; theme: Theme; children: React.ReactNode }) {
  const router = useRouter()
  const [locale, setLocaleState] = useState(initialLocale)
  const [theme, setThemeState] = useState(initialTheme)

  const setLocale = useCallback(
    (next: Locale) => {
      writeCookie(LOCALE_COOKIE, next)
      document.documentElement.lang = LOCALE_INFO[next].htmlLang
      setLocaleState(next)
      // Server-rendered titles and metadata follow on refresh.
      router.refresh()
    },
    [router],
  )

  const setTheme = useCallback((next: Theme) => {
    writeCookie(THEME_COOKIE, next)
    applyTheme(next)
    setThemeState(next)
  }, [])

  const value = useMemo<Prefs>(() => {
    const intl = LOCALE_INFO[locale].intl
    return {
      locale,
      theme,
      t: createTranslator(locale),
      setLocale,
      setTheme,
      formatDateTime: (v, opts) =>
        new Intl.DateTimeFormat(intl, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta', ...opts }).format(new Date(v)),
      formatNumber: (n) => new Intl.NumberFormat(intl).format(n),
    }
  }, [locale, theme, setLocale, setTheme])

  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>
}

export function usePrefs() {
  const value = useContext(PrefsCtx)
  if (!value) throw new Error('usePrefs must be used inside PrefsProvider')
  return value
}

/** Translate interface text: `const t = useT(); t('nav.pipelines')`. */
export function useT() {
  return usePrefs().t
}
