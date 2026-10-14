/**
 * Screenshots in the guide: real captures of a demo workspace (fictional HR
 * data from test-data/), one per language, in public/help/screens/<lang>/<key>.webp (and <key>-dark.webp).
 * Provenance and capture settings: public/help/screens/manifest.json.
 */
export const HELP_SCREENS = {
  overview: { width: 1440, height: 900 },
  connectors: { width: 1440, height: 900 },
  sources: { width: 1440, height: 900 },
  pipelines: { width: 1440, height: 900 },
  editor: { width: 1440, height: 900 },
  rules: { width: 1440, height: 900 },
  monitoring: { width: 1440, height: 900 },
  quality: { width: 1440, height: 900 },
  catalog: { width: 1440, height: 900 },
  governance: { width: 1440, height: 900 },
  analytics: { width: 1440, height: 900 },
  settings: { width: 1440, height: 900 },
} as const

export type HelpScreen = keyof typeof HELP_SCREENS

export const helpScreenSrc = (screen: HelpScreen, locale: string, theme: 'light' | 'dark') =>
  `/help/screens/${locale === 'id' ? 'id' : 'en'}/${screen}${theme === 'dark' ? '-dark' : ''}.webp`
