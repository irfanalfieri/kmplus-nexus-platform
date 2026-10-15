/**
 * Terms and Conditions of KMPlus Nexus (client-safe). Every account accepts the
 * current version once: on the sign-up form, or on the approval screen
 * (/accept-terms) at the first sign-in after a new version. Acceptances are
 * stored per version in terms_acceptances (lib/legal/acceptance.ts).
 *
 * To publish a change: edit both languages in lib/legal/terms-content/{en,id}.ts
 * (same section ids; engine-tests compares them), then set TERMS_VERSION to the
 * new effective date. Everyone is asked to accept again.
 */
import { termsEn } from './terms-content/en'
import { termsId } from './terms-content/id'

/** The version people accept: its effective date. */
export const TERMS_VERSION = '2026-10-15'

export interface TermsSection {
  id: string
  title: string
  /** Paragraphs; **bold** is supported. */
  body: string[]
  /** An optional list after the paragraphs. */
  items?: string[]
}

export interface TermsDocument {
  title: string
  /** One sentence under the title. */
  intro: string
  sections: TermsSection[]
}

export const TERMS: Record<'en' | 'id', TermsDocument> = { en: termsEn, id: termsId }

export const termsFor = (locale: string): TermsDocument => (locale === 'id' ? termsId : termsEn)
