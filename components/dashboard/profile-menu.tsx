'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Languages, LogOut, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { ROLE_INFO } from '@/lib/auth/permissions'
import { LOCALES, LOCALE_INFO, isLocale, isTheme } from '@/lib/i18n/config'
import { settingsHref } from '@/lib/navigation'
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuLinkItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { useWorkspace } from '@/components/workspace/workspace-context'

export function initials(name: string, email: string) {
  const parts = (name || email).trim().split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** Top-right account menu: who you are, where you are, appearance, language, sign out. */
export function ProfileMenu() {
  const { user, workspace, role } = useWorkspace()
  const { t, theme, setTheme, locale, setLocale } = usePrefs()
  const [signingOut, setSigningOut] = useState(false)
  const name = user.name || user.email

  return (
    <Menu>
      <MenuTrigger
        aria-label={t('profile.open', { name })}
        className="flex items-center gap-2.5 rounded-md py-1 pr-1 pl-1 text-left outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring data-[popup-open]:bg-muted md:pl-2"
      >
        <span className="hidden min-w-0 text-right leading-tight md:block">
          <span className="block max-w-48 truncate text-sm font-medium">{name}</span>
          <span className="block max-w-48 truncate text-xs text-muted-foreground">{workspace.name}</span>
        </span>
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials(user.name, user.email)}
        </span>
      </MenuTrigger>
      <MenuContent className="w-72">
        <div className="px-2 pt-1.5 pb-2">
          <p className="truncate font-medium">{name}</p>
          {user.name && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
          <p className="mt-1.5 truncate text-xs">
            {workspace.name} · <span className="text-muted-foreground">{t('profile.role', { role: ROLE_INFO[role].label })}</span>
          </p>
        </div>
        <MenuSeparator />
        <MenuGroup>
          <MenuLabel>{t('profile.appearance')}</MenuLabel>
          <MenuRadioGroup value={theme} onValueChange={(v) => isTheme(v) && setTheme(v)}>
            <MenuRadioItem value="system" closeOnClick={false}>
              <Monitor aria-hidden /> {t('profile.themeSystem')}
            </MenuRadioItem>
            <MenuRadioItem value="light" closeOnClick={false}>
              <Sun aria-hidden /> {t('profile.themeLight')}
            </MenuRadioItem>
            <MenuRadioItem value="dark" closeOnClick={false}>
              <Moon aria-hidden /> {t('profile.themeDark')}
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuGroup>
          <MenuLabel>{t('profile.language')}</MenuLabel>
          <MenuRadioGroup value={locale} onValueChange={(v) => isLocale(v) && setLocale(v)}>
            {LOCALES.map((l) => (
              <MenuRadioItem key={l} value={l} lang={LOCALE_INFO[l].htmlLang}>
                <Languages aria-hidden /> {LOCALE_INFO[l].label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuLinkItem render={<Link href={settingsHref('account')} />}>
          <ShieldCheck aria-hidden /> {t('profile.security')}
        </MenuLinkItem>
        <MenuItem
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true)
            await authClient.signOut()
            window.location.href = '/'
          }}
        >
          <LogOut aria-hidden /> {signingOut ? t('profile.signingOut') : t('profile.signOut')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
