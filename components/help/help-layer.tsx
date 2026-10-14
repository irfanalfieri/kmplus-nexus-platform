'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronRight, MessageCircleQuestion, Route, Search, SearchX } from 'lucide-react'
import { PageHeader } from '@/components/dashboard/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useT, usePrefs } from '@/components/i18n/i18n-provider'
import { useTour } from '@/components/tour/guided-tour'
import { cn } from '@/lib/utils'
import { sectionHref } from '@/lib/navigation'
import { HELP_SCREENS, helpScreenSrc } from '@/lib/help/screens'
import { blockText, matchesQuery } from '@/lib/help/search'
import type { HelpBlock, HelpChapter, HelpContent, HelpFaq } from '@/lib/help/types'
import { Diagram } from './diagrams'

/**
 * Help & FAQ (/dashboard/help), in the reader's language, in two parts:
 *   1. the product guide: numbered chapters in workflow order (1 Getting started,
 *      2 Connect your systems …), each with numbered sections (1.1, 1.2 …);
 *   2. the FAQ, set apart after the guide.
 * The sticky contents list shows both parts and follows the reading position;
 * search narrows chapters, sections and questions. Numbers stay stable while
 * searching.
 */
export default function HelpLayer({ content }: { content: HelpContent }) {
  const t = useT()
  const tour = useTour()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(content.chapters[0]?.id ?? 'faq')

  const numbers = useMemo(() => new Map(content.chapters.map((c, i) => [c.id, i + 1])), [content])

  // Search: a chapter stays when its title matches (all sections) or when any section matches.
  const view = useMemo(() => {
    const q = query.trim()
    if (!q) return { chapters: content.chapters, faqs: content.faqs, sections: content.chapters.reduce((n, c) => n + c.sections.length, 0) }
    let sections = 0
    const chapters = content.chapters
      .map((c) => {
        if (matchesQuery(`${c.title} ${c.summary}`, q)) {
          sections += c.sections.length
          return c
        }
        const kept = c.sections.filter((s) => matchesQuery(`${s.title} ${s.blocks.map(blockText).join(' ')}`, q))
        sections += kept.length
        return kept.length ? { ...c, sections: kept } : null
      })
      .filter((c): c is HelpChapter => c !== null)
    const faqs = content.faqs.filter((f) => matchesQuery(`${f.q} ${f.a}`, q))
    return { chapters, faqs, sections }
  }, [content, query])

  const faqGroups = useMemo(() => content.faqGroups.filter((g) => view.faqs.some((f) => f.group === g.id)), [content.faqGroups, view.faqs])

  // Reading position: the last chapter, section or FAQ topic whose top has passed the top of main.
  useEffect(() => {
    const root = document.getElementById('main')
    if (!root) return
    const ids = [
      ...view.chapters.flatMap((c) => [c.id, ...c.sections.map((s) => sectionId(c.id, s.id))]),
      ...(faqGroups.length ? ['faq', ...faqGroups.map((g) => `faq-group-${g.id}`)] : []),
    ]
    let frame = 0
    const update = () => {
      const line = root.getBoundingClientRect().top + 96
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      if (current) setActive(current)
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      root.removeEventListener('scroll', onScroll)
    }
  }, [view.chapters, faqGroups])

  // Arriving at #faq-… opens that question.
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      const el = id ? document.getElementById(id) : null
      if (el instanceof HTMLDetailsElement) el.open = true
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])

  const searching = query.trim().length > 0
  const nothing = searching && view.chapters.length === 0 && view.faqs.length === 0
  const activeChapter = active.startsWith('faq') ? 'faq' : active.split('-')[0]
  const sectionCount = content.chapters.reduce((n, c) => n + c.sections.length, 0)

  return (
    <div className="relative">
      <PageHeader
        title={t('pages.help.title')}
        description={t('pages.help.description')}
        meta={`${t('tour.page.chapters', { count: content.chapters.length })} · ${t('tour.page.sections', { count: sectionCount })} · ${t('tour.page.faqCount', { count: content.faqs.length })}`}
        actions={
          <Button onClick={tour.start}>
            <Route aria-hidden /> {t('tour.page.startTour')}
          </Button>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] xl:gap-12">
        <aside className="lg:sticky lg:top-0 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pb-6">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('tour.page.searchPlaceholder')}
              aria-label={t('tour.page.searchLabel')}
              className="pl-8"
            />
          </div>
          <p className="mt-2 min-h-4 font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {searching && !nothing ? t('tour.page.matches', { count: view.sections + view.faqs.length }) : ''}
          </p>
          <nav aria-label={t('tour.page.contents')} className="mt-3 hidden lg:block">
            {view.chapters.length > 0 && (
              <>
                <p className="mb-1.5 font-mono text-[11px] font-medium tracking-[0.025em] text-muted-foreground uppercase">{t('tour.page.guidePart')}</p>
                <ol className="border-l border-border">
                  {view.chapters.map((c) => (
                    <li key={c.id}>
                      <TocLink href={`#${c.id}`} number={`${numbers.get(c.id)}`} label={c.title} current={active === c.id} within={activeChapter === c.id} />
                      {(activeChapter === c.id || searching) && (
                        <ol className="mb-1">
                          {c.sections.map((s) => {
                            const id = sectionId(c.id, s.id)
                            return (
                              <li key={s.id}>
                                <TocLink href={`#${id}`} number={sectionNumber(content, c.id, s.id)} label={s.title} current={active === id} nested />
                              </li>
                            )
                          })}
                        </ol>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {faqGroups.length > 0 && (
              <>
                <p className="mt-6 mb-1.5 font-mono text-[11px] font-medium tracking-[0.025em] text-muted-foreground uppercase">{t('tour.page.faqPart')}</p>
                <ol className="border-l border-border">
                  {faqGroups.map((g) => {
                    const id = `faq-group-${g.id}`
                    return (
                      <li key={g.id}>
                        <TocLink href={`#${id}`} label={g.title} current={active === id} within={active === id} />
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
          </nav>
        </aside>

        <div className="min-w-0 max-w-[56rem]">
          {!searching && (
            <div className="mb-10 rounded-md border border-border bg-card p-5">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="min-w-0 flex-[1_1_16rem]">
                  <h2 className="text-base font-semibold">{t('tour.page.startTour')}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">{t('tour.page.startTourBody')}</p>
                </div>
                <Button variant="outline" onClick={tour.start}>
                  {t('tour.guideMe')} <ArrowRight aria-hidden />
                </Button>
              </div>
              {/* Phones and tablets have no side contents list: the chapters as links. */}
              <ol className="mt-4 grid gap-x-6 gap-y-1.5 border-t border-border pt-4 text-sm sm:grid-cols-2 lg:hidden">
                {content.chapters.map((c, i) => (
                  <li key={c.id} className="flex gap-2">
                    <span className="w-5 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular-nums">{i + 1}</span>
                    <a href={`#${c.id}`} className="text-info-text underline-offset-4 hover:underline">
                      {c.title}
                    </a>
                  </li>
                ))}
                <li className="flex gap-2">
                  <span className="w-5 shrink-0" />
                  <a href="#faq" className="font-medium text-info-text underline-offset-4 hover:underline">
                    {t('tour.page.faqTitle')}
                  </a>
                </li>
              </ol>
            </div>
          )}

          {nothing ? (
            <EmptyState icon={<SearchX />} title={t('tour.page.noMatch', { query: query.trim() })}>
              <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                {t('tour.page.clearSearch')}
              </Button>
            </EmptyState>
          ) : (
            <>
              <div className="space-y-16">
                {view.chapters.map((c) => (
                  <Chapter key={c.id} chapter={c} number={numbers.get(c.id)!} content={content} />
                ))}
              </div>
              {faqGroups.length > 0 && <Faq groups={faqGroups} faqs={view.faqs} open={searching} afterGuide={view.chapters.length > 0} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const sectionId = (chapter: string, section: string) => `${chapter}-${section}`

function sectionNumber(content: HelpContent, chapter: string, section: string) {
  const ci = content.chapters.findIndex((c) => c.id === chapter)
  const si = content.chapters[ci]?.sections.findIndex((s) => s.id === section) ?? -1
  return `${ci + 1}.${si + 1}`
}

function TocLink({ href, number, label, current, within, nested }: { href: string; number?: string; label: string; current: boolean; within?: boolean; nested?: boolean }) {
  return (
    <a
      href={href}
      aria-current={current ? 'location' : undefined}
      className={cn(
        '-ml-px flex gap-2 border-l-2 border-transparent py-1 pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
        nested ? 'pl-5 text-xs leading-5' : 'pl-3',
        within && !nested && 'font-medium text-foreground',
        current && 'border-live text-foreground',
      )}
    >
      {number && <span className={cn('shrink-0 font-mono text-xs leading-5 tabular-nums', nested ? 'w-8' : 'w-4 text-right')}>{number}</span>}
      <span className="min-w-0">{label}</span>
    </a>
  )
}

function Chapter({ chapter, number, content }: { chapter: HelpChapter; number: number; content: HelpContent }) {
  const t = useT()
  return (
    <section id={chapter.id} aria-labelledby={`${chapter.id}-title`} className="scroll-mt-6">
      {/* The chapter's plate: number, title, what it covers, and its sections. */}
      <div className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 p-5">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-sm border-2 border-live font-mono text-base font-medium text-live-text tabular-nums">
            {number}
          </span>
          <div className="min-w-0 flex-[1_1_18rem]">
            <h2 id={`${chapter.id}-title`} className="text-xl leading-7 font-normal tracking-[-0.005em] text-balance">
              <span className="sr-only">{t('tour.page.chapterNumber', { n: number })} </span>
              {chapter.title}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-pretty text-muted-foreground">{chapter.summary}</p>
          </div>
          {chapter.screen && (
            <Link href={sectionHref(chapter.screen)} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {t('tour.page.openScreen', { screen: t(`nav.${chapter.screen}`) })} <ChevronRight aria-hidden />
            </Link>
          )}
        </div>
        <nav aria-label={t('tour.page.inChapter', { title: chapter.title })} className="border-t border-border px-5 py-3">
          <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {chapter.sections.map((s) => (
              <li key={s.id} className="flex gap-2.5">
                <span className="w-8 shrink-0 font-mono text-xs leading-5 text-muted-foreground tabular-nums">{sectionNumber(content, chapter.id, s.id)}</span>
                <a href={`#${sectionId(chapter.id, s.id)}`} className="min-w-0 text-info-text underline-offset-4 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      {chapter.sections.map((s) => (
        <div key={s.id} id={sectionId(chapter.id, s.id)} className="mt-10 scroll-mt-6">
          <h3 className="flex items-baseline gap-3 text-base font-semibold">
            <span className="font-mono text-sm font-medium text-muted-foreground tabular-nums">{sectionNumber(content, chapter.id, s.id)}</span>
            <span>{s.title}</span>
          </h3>
          <div className="mt-3 space-y-4">
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} content={content} />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

function Block({ block, content }: { block: HelpBlock; content: HelpContent }) {
  const t = useT()
  const { locale } = usePrefs()
  switch (block.kind) {
    case 'p':
      return (
        <p className="max-w-3xl text-sm leading-6 text-pretty">
          <Rich text={block.text} />
        </p>
      )
    case 'list':
      return (
        <ul className="max-w-3xl space-y-2 text-sm leading-6">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className="mt-[0.55rem] size-1.5 shrink-0 rounded-[1px] bg-live" />
              <span className="min-w-0 text-pretty">
                <Rich text={item} />
              </span>
            </li>
          ))}
        </ul>
      )
    case 'steps':
      return (
        <ol className="max-w-3xl space-y-2.5 text-sm leading-6">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[1px] border-2 border-live font-mono text-[11px] font-medium text-live-text tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 text-pretty">
                <Rich text={item} />
              </span>
            </li>
          ))}
        </ol>
      )
    case 'note':
      return (
        <Notice tone={block.tone} live={false} className="max-w-3xl">
          <Rich text={block.text} />
        </Notice>
      )
    case 'code':
      return <pre className="max-w-3xl overflow-x-auto rounded-md border border-border bg-muted/50 px-3 py-2.5 font-mono text-xs leading-5">{block.text}</pre>
    case 'table':
      return (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="h-9 bg-muted/60">
                {block.head.map((h) => (
                  <th key={h} scope="col" className="px-4 text-left font-mono text-[11px] font-medium tracking-[0.025em] whitespace-nowrap text-muted-foreground uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-t border-border align-top">
                  {row.map((cell, j) =>
                    j === 0 ? (
                      <th key={j} scope="row" className="px-4 py-2.5 text-left font-medium whitespace-nowrap">
                        <Rich text={cell} />
                      </th>
                    ) : (
                      <td key={j} className="px-4 py-2.5 text-pretty">
                        <Rich text={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'diagram':
      return (
        <figure>
          <div className="rounded-md border border-border bg-card p-5">
            <Diagram diagram={block.diagram} labels={content.diagrams} />
          </div>
          <figcaption className="mt-2 max-w-3xl text-xs text-pretty text-muted-foreground">{block.caption}</figcaption>
        </figure>
      )
    case 'shot': {
      const size = HELP_SCREENS[block.screen]
      const light = helpScreenSrc(block.screen, locale, 'light')
      const dark = helpScreenSrc(block.screen, locale, 'dark')
      return (
        <figure>
          <a
            href={light}
            target="_blank"
            rel="noopener"
            className="block overflow-hidden rounded-md border border-border bg-background outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={t('tour.page.screenshot', { caption: block.caption })}
          >
            <img src={light} width={size.width} height={size.height} loading="lazy" decoding="async" alt="" className="block h-auto w-full dark:hidden" />
            <img src={dark} width={size.width} height={size.height} loading="lazy" decoding="async" alt="" className="hidden h-auto w-full dark:block" />
          </a>
          <figcaption className="mt-2 max-w-3xl text-xs text-pretty text-muted-foreground">{block.caption}</figcaption>
        </figure>
      )
    }
  }
}

function Faq({ groups, faqs, open, afterGuide }: { groups: HelpContent['faqGroups']; faqs: HelpFaq[]; open: boolean; afterGuide: boolean }) {
  const t = useT()
  return (
    <section id="faq" aria-labelledby="faq-title" className={cn('scroll-mt-6', afterGuide && 'mt-20 border-t-2 border-foreground/70 pt-12')}>
      {/* The second part of the page, set apart from the guide by a heavy rule and its own plate. */}
      <div className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-start gap-x-5 gap-y-3 p-5">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-sm border-2 border-info text-info-text">
            <MessageCircleQuestion className="size-5" />
          </span>
          <div className="min-w-0 flex-[1_1_18rem]">
            <h2 id="faq-title" className="text-xl leading-7 font-normal tracking-[-0.005em]">
              {t('tour.page.faqTitle')}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-pretty text-muted-foreground">{t('tour.page.faqIntro')}</p>
            <p className="mt-1.5 font-mono text-xs text-muted-foreground tabular-nums">{t('tour.page.faqCount', { count: faqs.length })}</p>
          </div>
        </div>
        <nav aria-label={t('tour.page.faqTopics')} className="border-t border-border px-5 py-3">
          <ul className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <li key={g.id}>
                <a href={`#faq-group-${g.id}`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'font-normal')}>
                  {g.title}
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{faqs.filter((f) => f.group === g.id).length}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {groups.map((g) => (
        <div key={g.id} id={`faq-group-${g.id}`} className="mt-10 scroll-mt-6">
          <h3 className="text-base font-semibold">{g.title}</h3>
          <div className="mt-3 max-w-3xl divide-y divide-border rounded-md border border-border bg-card">
            {faqs
              .filter((f) => f.group === g.id)
              .map((f) => (
                <details key={f.id} id={`faq-${f.id}`} open={open || undefined} className="group scroll-mt-6">
                  <summary className="flex cursor-pointer list-none items-start gap-2.5 px-4 py-3 text-sm font-medium outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90" />
                    <span className="text-pretty">{f.q}</span>
                  </summary>
                  <p className="px-4 pb-3.5 pl-[2.625rem] text-sm leading-6 text-pretty text-muted-foreground">
                    <Rich text={f.a} />
                  </p>
                </details>
              ))}
          </div>
        </div>
      ))}
    </section>
  )
}

/** **bold**, *emphasis* and `code`; everything else is plain text. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="rounded-[1px] bg-muted px-1 py-px font-mono text-xs break-words">{part.slice(1, -1)}</code>
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
        return <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}
