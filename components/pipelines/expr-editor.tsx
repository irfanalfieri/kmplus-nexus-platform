'use client'

import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { EXPR_FNS, EXPR_OPS, type Expr } from '@/lib/pipelines/definition'
import { ColumnPicker, NativeSelect, type Column } from '@/components/pipelines/step-editors'

/** Builds a calculated value (`Expr`): fields, fixed values, arithmetic and functions. Shared by business rules and API bodies. */
export function ExprEditor({ expr, columns, onChange, depth = 0 }: { expr: Expr; columns: Column[]; onChange: (e: Expr) => void; depth?: number }) {
  const { t } = usePrefs()
  const setKind = (kind: string) => {
    if (kind === 'field') onChange({ kind: 'field', name: columns[0]?.name ?? '' })
    else if (kind === 'value') onChange({ kind: 'value', value: '' })
    else if ((EXPR_OPS as readonly string[]).includes(kind)) onChange({ kind: 'op', op: kind as (typeof EXPR_OPS)[number], left: expr.kind === 'op' ? expr.left : expr, right: expr.kind === 'op' ? expr.right : { kind: 'value', value: '' } })
    else onChange({ kind: 'fn', fn: kind as (typeof EXPR_FNS)[number], args: kind === 'today' ? [] : kind === 'days_between' ? [{ kind: 'field', name: columns[0]?.name ?? '' }, { kind: 'fn', fn: 'today', args: [] }] : [expr.kind === 'fn' ? expr.args[0] ?? { kind: 'field', name: '' } : expr] })
  }
  const kindValue = expr.kind === 'op' ? expr.op : expr.kind === 'fn' ? expr.fn : expr.kind
  return (
    <div className={`space-y-1.5 ${depth ? 'border-l-2 border-primary/30 pl-2' : ''}`}>
      <div className="flex gap-1.5">
        <NativeSelect className="w-40" value={kindValue} onChange={setKind} aria-label={t('ops.rules.expr.part')}>
          <option value="field">{t('ops.rules.expr.field')}</option>
          <option value="value">{t('ops.rules.expr.value')}</option>
          {depth < 3 && (
            <>
              {EXPR_OPS.map((op) => (
                <option key={op} value={op}>
                  {op === 'concat' ? t('ops.rules.expr.concat') : t('ops.rules.expr.op', { op })}
                </option>
              ))}
              {EXPR_FNS.map((fn) => (
                <option key={fn} value={fn}>
                  {fn}()
                </option>
              ))}
            </>
          )}
        </NativeSelect>
        {expr.kind === 'field' && <ColumnPicker columns={columns} value={expr.name} onChange={(name) => onChange({ kind: 'field', name })} label={t('ops.rules.expr.fieldLabel')} />}
        {expr.kind === 'value' && <Input value={expr.value} onChange={(e) => onChange({ kind: 'value', value: e.target.value })} placeholder={t('ops.rules.expr.valuePlaceholder')} aria-label={t('ops.rules.expr.valueLabel')} />}
      </div>
      {expr.kind === 'op' && (
        <>
          <ExprEditor expr={expr.left} columns={columns} depth={depth + 1} onChange={(left) => onChange({ ...expr, left })} />
          <ExprEditor expr={expr.right} columns={columns} depth={depth + 1} onChange={(right) => onChange({ ...expr, right })} />
        </>
      )}
      {expr.kind === 'fn' &&
        expr.args.map((a, i) => <ExprEditor key={i} expr={a} columns={columns} depth={depth + 1} onChange={(next) => onChange({ ...expr, args: expr.args.map((x, j) => (j === i ? next : x)) })} />)}
      {expr.kind === 'fn' && (expr.fn === 'coalesce' || expr.fn === 'round') && expr.args.length < (expr.fn === 'round' ? 2 : 5) && (
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...expr, args: [...expr.args, { kind: 'value', value: '' }] })}>
          <Plus aria-hidden /> {expr.fn === 'round' ? t('ops.rules.expr.decimals') : t('ops.rules.expr.fallback')}
        </Button>
      )}
    </div>
  )
}
