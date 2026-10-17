import type { Widget, WidgetResult } from './definition'

/**
 * DB-5: a widget as a PNG, drawn from its result on a canvas (browser only).
 * Colours come from the theme tokens on <html>, so the image matches the
 * screen (light or dark); text is the widget's title and its labels.
 */

const W = 1200
const PAD = 40

function token(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const show = (v: number | null) => (v === null ? '—' : fmt.format(v))

function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1)
  return `${t}…`
}

export function drawWidget(widget: Widget, result: WidgetResult, opts: { title: string; subtitle?: string; scale?: number }): HTMLCanvasElement {
  const colors = {
    bg: token('--card', '#ffffff'),
    fg: token('--foreground', '#161616'),
    muted: token('--muted-foreground', '#525252'),
    border: token('--border', '#e0e0e0'),
    series: token('--chart-1', '#0072c3'),
  }
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const rows = result.rows
  const bodyH = widget.type === 'kpi' ? 140 : widget.type === 'line' ? 360 : Math.max(60, rows.length * 34 + 20)
  const H = PAD * 2 + 64 + bodyH
  const scale = opts.scale ?? 2
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = colors.fg
  ctx.font = `600 24px ${font}`
  ctx.textBaseline = 'top'
  ctx.fillText(fit(ctx, opts.title, W - PAD * 2), PAD, PAD)
  if (opts.subtitle) {
    ctx.fillStyle = colors.muted
    ctx.font = `14px ${font}`
    ctx.fillText(fit(ctx, opts.subtitle, W - PAD * 2), PAD, PAD + 34)
  }
  const top = PAD + 64

  if (widget.type === 'kpi') {
    ctx.fillStyle = colors.fg
    ctx.font = `600 72px ${font}`
    ctx.fillText(show(rows[0]?.value ?? null), PAD, top + 20)
    return canvas
  }

  if (widget.type === 'line') {
    const values = rows.map((r) => r.value ?? 0)
    const max = Math.max(...values, 0)
    const min = Math.min(...values, 0)
    const left = PAD
    const right = W - PAD
    const bottom = top + bodyH - 36
    const y = (v: number) => bottom - ((v - min) / (max - min || 1)) * (bodyH - 60)
    const x = (i: number) => left + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * (right - left))
    ctx.strokeStyle = colors.border
    ctx.lineWidth = 1
    for (const f of [0, 0.5, 1]) {
      const gy = bottom - f * (bodyH - 60)
      ctx.beginPath()
      ctx.moveTo(left, gy)
      ctx.lineTo(right, gy)
      ctx.stroke()
    }
    ctx.strokeStyle = colors.series
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.beginPath()
    rows.forEach((r, i) => (i ? ctx.lineTo(x(i), y(r.value ?? 0)) : ctx.moveTo(x(i), y(r.value ?? 0))))
    ctx.stroke()
    ctx.fillStyle = colors.muted
    ctx.font = `13px ${font}`
    const marks = Array.from(new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])).filter((i) => i >= 0)
    for (const i of marks) {
      ctx.textAlign = i === 0 ? 'left' : i === rows.length - 1 ? 'right' : 'center'
      ctx.fillText(rows[i].label ?? '∅', x(i), bottom + 12)
    }
    const last = rows[rows.length - 1]
    if (last) {
      ctx.fillStyle = colors.fg
      ctx.textAlign = 'right'
      ctx.font = `600 14px ${font}`
      ctx.fillText(show(last.value), x(rows.length - 1), y(last.value ?? 0) - 22)
    }
    ctx.textAlign = 'left'
    return canvas
  }

  // Bars and tables: one line per group, label, bar (bars only) and value.
  const labelW = 320
  const valueW = 140
  const barW = W - PAD * 2 - labelW - valueW
  const max = Math.max(...rows.map((r) => Math.abs(r.value ?? 0)), 0)
  rows.forEach((r, i) => {
    const ry = top + i * 34
    ctx.fillStyle = colors.fg
    ctx.font = `15px ${font}`
    ctx.textAlign = 'left'
    ctx.fillText(fit(ctx, r.label ?? '∅', labelW - 16), PAD, ry + 6)
    if (widget.type === 'bar' && max > 0) {
      ctx.fillStyle = colors.series
      ctx.fillRect(PAD + labelW, ry + 4, Math.max(2, (Math.abs(r.value ?? 0) / max) * barW), 22)
    } else {
      ctx.strokeStyle = colors.border
      ctx.beginPath()
      ctx.moveTo(PAD, ry + 32)
      ctx.lineTo(W - PAD, ry + 32)
      ctx.stroke()
    }
    ctx.fillStyle = colors.fg
    ctx.textAlign = 'right'
    ctx.font = `600 15px ${font}`
    ctx.fillText(show(r.value), W - PAD, ry + 6)
  })
  ctx.textAlign = 'left'
  return canvas
}

/** Downloads the widget as `<title>.png`. */
export async function downloadWidgetPng(widget: Widget, result: WidgetResult, title: string, subtitle?: string) {
  const canvas = drawWidget(widget, result, { title, subtitle })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The image could not be created')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'widget'}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
