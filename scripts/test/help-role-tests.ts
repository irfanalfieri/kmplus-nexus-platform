/**
 * Help & FAQ "Read as" (lib/help/access.ts): the section map names real
 * sections, every role's tasks link to sections that role reads, both
 * languages agree, and narrowing never drops a section. Pure; run from
 * scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { HELP_CONTENT } from '@/lib/help'
import { SECTION_ACCESS, guideFor, rolesFor, sectionFor, sectionKey } from '@/lib/help/access'
import { ROLES } from '@/lib/auth/permissions'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

export async function helpRoleTests(test: Test) {
  await test('help roles: the section map names real sections; every role reads something; admins read everything', () => {
    const en = HELP_CONTENT.en
    const keys = new Set(en.chapters.flatMap((c) => c.sections.map((s) => sectionKey(c.id, s.id))))
    for (const k of Object.keys(SECTION_ACCESS)) assert.ok(keys.has(k), `SECTION_ACCESS names a missing section: ${k}`)
    const total = keys.size
    for (const role of ROLES) {
      const { chapters, hidden } = guideFor(en, role)
      const shown = chapters.reduce((n, c) => n + c.sections.length, 0)
      const left = hidden.reduce((n, h) => n + h.sections.length, 0)
      assert.equal(shown + left, total, `${role}: every section is either shown or listed for other roles`)
      assert.ok(shown >= 15, `${role} reads ${shown} sections`)
    }
    assert.equal(guideFor(en, 'admin').hidden.length, 0, 'admins read the whole guide')
    assert.equal(guideFor(en, 'all').chapters, en.chapters)
    assert.equal(sectionFor('viewer', 'connect', 'sources'), false)
    assert.equal(sectionFor('steward', 'quality', 'fix'), true)
    assert.equal(sectionFor('operator', 'monitoring', 'retry'), true)
    assert.equal(sectionFor('analyst', 'analytics', 'widget'), true)
    assert.equal(sectionFor('auditor', 'governance', 'audit'), true)
    assert.equal(sectionFor('viewer', 'start', 'your-role'), true, 'an unlisted section is for everyone')
    assert.deepEqual(rolesFor('governance', 'retention'), ['admin', 'steward'])
  })

  await test('help roles: every role guide links to sections that role reads, the same in English and Indonesian', () => {
    for (const role of ROLES) {
      const en = HELP_CONTENT.en.roleGuides[role]
      const id = HELP_CONTENT.id.roleGuides[role]
      assert.ok(en.who && id.who, role)
      assert.ok(en.tasks.length >= 4, `${role} has main tasks`)
      assert.deepEqual(id.tasks.map((x) => x.section), en.tasks.map((x) => x.section), `${role}: same task links in both languages`)
      for (const task of en.tasks) {
        const [c, s] = task.section.split('.')
        assert.ok(HELP_CONTENT.en.chapters.some((ch) => ch.id === c && ch.sections.some((x) => x.id === s)), `${role}: ${task.section} exists`)
        assert.ok(sectionFor(role, c, s), `${role} can read ${task.section}`)
      }
    }
  })
}
