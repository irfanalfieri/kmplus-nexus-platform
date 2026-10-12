/**
 * Interface languages (PRODUCT.md: English and Bahasa Indonesia, switchable).
 * Client-safe. The choice lives in a cookie so the server renders the first
 * paint in the right language; data and column names are never translated.
 */
export const LOCALES = ['en', 'id'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'nexus_lang'

export const LOCALE_INFO: Record<Locale, { label: string; intl: string; htmlLang: string }> = {
  en: { label: 'English', intl: 'en-GB', htmlLang: 'en' },
  id: { label: 'Bahasa Indonesia', intl: 'id-ID', htmlLang: 'id' },
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** Appearance (light / dark / follow the system), stored like the language. */
export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]
export const THEME_COOKIE = 'nexus_theme'
export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}
