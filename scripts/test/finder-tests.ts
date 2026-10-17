/**
 * "Go to" finder (lib/finder.ts): every feature has a link into a real screen
 * and labels in both languages; search finds features by English or
 * Indonesian words. Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { FEATURES, PREFERENCES, SECTION_KEYWORDS, SETTINGS_KEYWORDS, fold, recordHref, searchFinder, type FinderItem } from '@/lib/finder'
import { SECTIONS, SETTINGS_TABS } from '@/lib/navigation'
import { en } from '@/lib/i18n/messages/en'
import { id } from '@/lib/i18n/messages/id'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

const item = (over: Partial<FinderItem> & Pick<FinderItem, 'id' | 'label'>): FinderItem => ({ kind: 'action', hint: '', section: 'pipelines', ...over })

export async function finderTests(test: Test) {
  await test('finder: every feature links into a dashboard screen and is labelled in English and Indonesian', () => {
    for (const f of FEATURES) {
      assert.match(f.href, new RegExp(`^/dashboard/${f.section}([/?#]|$)`), f.id)
      assert.ok((en.finder.features as Record<string, string>)[f.id], `en label for ${f.id}`)
      assert.ok((id.finder.features as Record<string, string>)[f.id], `id label for ${f.id}`)
    }
    for (const p of PREFERENCES) assert.ok((en.finder.preferences as Record<string, string>)[p.id] && (id.finder.preferences as Record<string, string>)[p.id], p.id)
    assert.equal(new Set(FEATURES.map((f) => f.id)).size, FEATURES.length, 'feature ids are unique')
    for (const s of SECTIONS) assert.ok(SECTION_KEYWORDS[s], s)
    for (const s of SETTINGS_TABS) assert.ok(SETTINGS_KEYWORDS[s], s)
    assert.equal(recordHref.dataset('employees'), '/dashboard/catalog?item=dataset%3Aemployees')
    assert.equal(recordHref.pipeline('p 1'), '/dashboard/pipelines?edit=p%201')
  })

  await test('finder: search by label, by keyword in either language, several words, accents ignored; empty lists screens and features', () => {
    const items: FinderItem[] = [
      ...FEATURES.map((f) => item({ id: f.id, label: (en.finder.features as Record<string, string>)[f.id], keywords: f.keywords, section: f.section, href: f.href })),
      item({ id: 'settings-access', kind: 'setting', label: 'Sign-in, SSO & SCIM', keywords: SETTINGS_KEYWORDS.access, section: 'settings' }),
      item({ id: 'screen-governance', kind: 'screen', label: 'Governance', keywords: SECTION_KEYWORDS.governance, section: 'governance' }),
      item({ id: 'pipeline-1', kind: 'record', label: 'SAP employees → Employee', hint: 'Pipeline' }),
      item({ id: 'dataset-1', kind: 'record', label: 'employees_kmi', hint: 'Dataset' }),
      item({ id: 'pref-dark', kind: 'preference', label: 'Use the dark theme', keywords: 'dark mode gelap' }),
    ]
    const ids = (q: string) => searchFinder(items, q).map((i) => i.id)
    assert.equal(ids('maint')[0], 'maintenance')
    assert.equal(ids('pemeliharaan')[0], 'maintenance', 'Indonesian keyword')
    assert.equal(ids('erasure')[0], 'erasure')
    assert.equal(ids('hak penghapusan')[0], 'erasure', 'several Indonesian words')
    assert.equal(ids('okta')[0], 'settings-access')
    assert.equal(ids('new pipe')[0], 'newPipeline')
    assert.deepEqual(ids('employees').slice(0, 2).sort(), ['dataset-1', 'pipeline-1'])
    assert.equal(ids('gelap')[0], 'pref-dark')
    assert.equal(ids('uu pdp')[0], 'erasure')
    assert.deepEqual(ids('zzz-nothing'), [])
    assert.equal(fold('Kebijakán'), 'kebijakan')
    const empty = searchFinder(items, '  ')
    assert.ok(empty.length > 0 && empty.every((i) => i.kind === 'screen' || i.kind === 'action'), 'empty query: screens and features only')
  })
}
