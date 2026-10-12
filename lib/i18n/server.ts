import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, isLocale, isTheme, LOCALE_COOKIE, THEME_COOKIE, type Locale, type Theme } from './config'
import { createTranslator } from './translate'

/** The signed-in user's interface language (cookie), English by default. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : DEFAULT_LOCALE
}

export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value
  return isTheme(value) ? value : 'system'
}

export async function getTranslator() {
  return createTranslator(await getLocale())
}
