import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import type { TermsDocument } from '@/lib/legal/terms'

/** **bold** in the terms' text; everything else is plain. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * The Terms and Conditions as an article: numbered sections, each an h2 (the
 * page or dialog holds the h1). Server- and client-safe.
 */
export function TermsArticle({ doc, idPrefix = 'terms', className }: { doc: TermsDocument; idPrefix?: string; className?: string }) {
  return (
    <div className={cn('space-y-6 text-sm leading-6 text-pretty', className)}>
      {doc.sections.map((s) => (
        <section key={s.id} id={`${idPrefix}-${s.id}`} aria-labelledby={`${idPrefix}-${s.id}-title`} className="scroll-mt-6">
          <h2 id={`${idPrefix}-${s.id}-title`} className="text-base font-semibold">
            {s.title}
          </h2>
          {s.body.map((p, i) => (
            <p key={i} className="mt-2 text-muted-foreground">
              <Rich text={p} />
            </p>
          ))}
          {s.items && (
            <ul className="mt-2 space-y-1.5 text-muted-foreground">
              {s.items.map((item, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.6rem] size-1.5 shrink-0 rounded-[1px] bg-live" />
                  <span className="min-w-0">
                    <Rich text={item} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
