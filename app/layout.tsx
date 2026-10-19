import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { PrefsProvider } from '@/components/i18n/i18n-provider'
import { LOCALE_INFO } from '@/lib/i18n/config'
import { getLocale, getTheme } from '@/lib/i18n/server'
import './globals.css'

// The KM+ colour guide is set in IBM Plex; the app uses the same family (self-hosted by next/font).
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-plex-sans', display: 'swap' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'KMPlus Nexus', template: '%s · KMPlus Nexus' },
  description: 'Connect, check, govern and deliver HR data to KMPlus products and other systems.',
  applicationName: 'KMPlus Nexus',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f4f8' },
    { media: '(prefers-color-scheme: dark)', color: '#121619' },
  ],
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()])
  const themeClass = theme === 'system' ? '' : theme
  return (
    <html lang={LOCALE_INFO[locale].htmlLang} className={`${plexSans.variable} ${plexMono.variable} ${themeClass}`} suppressHydrationWarning>
      <body className="antialiased">
        <PrefsProvider locale={locale} theme={theme}>
          {children}
        </PrefsProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
