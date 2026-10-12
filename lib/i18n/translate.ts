/** Client-safe translation helpers. */
import { en, type Messages } from './messages/en'
import { id } from './messages/id'
import { LOCALE_INFO, type Locale } from './config'

export const MESSAGES: Record<Locale, Messages> = { en, id }

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>
}[keyof T & string]

/** Every translatable key, e.g. `nav.pipelines`. */
export type MessageKey = Leaves<Messages>
export type TranslateVars = Record<string, string | number>
export type Translate = (key: MessageKey, vars?: TranslateVars) => string

const PLURAL = /\{(\w+), plural, one \{([^{}]*)\} other \{([^{}]*)\}\}/g
const VAR = /\{(\w+)\}/g

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return typeof node === 'string' ? node : undefined
}

export function createTranslator(locale: Locale): Translate {
  const messages = MESSAGES[locale]
  const plurals = new Intl.PluralRules(LOCALE_INFO[locale].intl)
  return (key, vars) => {
    // Fall back to English, then to the key itself, so a missing string never blanks the UI.
    const text = lookup(messages, key) ?? lookup(en, key) ?? key
    if (!vars) return text
    // ICU-style plurals: "{count, plural, one {# source} other {# sources}}"; # is the value as passed.
    const counted = text.replace(PLURAL, (m, name: string, one: string, other: string) => {
      if (!(name in vars)) return m
      const raw = vars[name]
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^\d.-]/g, ''))
      return (plurals.select(n) === 'one' ? one : other).replace(/#/g, String(raw))
    })
    return counted.replace(VAR, (m, name: string) => (name in vars ? String(vars[name]) : m))
  }
}
