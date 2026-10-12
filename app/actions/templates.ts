'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { mappingTemplates } from '@/lib/db/schema'
import { newId, requireWorkspace } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { COLUMN_TYPES, TRANSFORMS } from '@/lib/pipelines/definition'
import { guard } from '@/lib/server-action'

/** Workspace mapping templates (MP-10): a Map step's field list saved under a name for reuse. */

const fieldSchema = z.object({
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  type: z.enum(COLUMN_TYPES),
  transforms: z.array(z.object({ fn: z.enum(TRANSFORMS), args: z.array(z.string().max(500)).max(6).default([]) })).max(10).default([]),
})

const saveInput = z.object({
  name: z.string().trim().min(1, 'Name the template').max(80),
  description: z.string().trim().max(300).default(''),
  fields: z.array(fieldSchema).min(1, 'The Map step has no fields to save').max(300),
  keepUnmapped: z.boolean().default(false),
})

async function saveMappingTemplateImpl(input: z.input<typeof saveInput>) {
  const ctx = await requireWorkspace('pipelines:edit')
  const data = saveInput.parse(input)
  const [existing] = await db.select({ id: mappingTemplates.id }).from(mappingTemplates).where(and(eq(mappingTemplates.workspaceId, ctx.workspaceId), eq(mappingTemplates.name, data.name))).limit(1)
  const id = existing?.id ?? newId('mtpl')
  if (existing) {
    await db.update(mappingTemplates).set({ description: data.description, fields: data.fields, keepUnmapped: data.keepUnmapped, updatedAt: new Date() }).where(eq(mappingTemplates.id, id))
  } else {
    await db.insert(mappingTemplates).values({ id, workspaceId: ctx.workspaceId, name: data.name, description: data.description, fields: data.fields, keepUnmapped: data.keepUnmapped, createdBy: ctx.userId })
  }
  await recordAudit(ctx, { action: existing ? 'UPDATE' : 'CREATE', resource: 'mapping_template', resourceId: id, changes: { name: data.name, fields: data.fields.length } })
  revalidatePath('/dashboard', 'layout')
  return { id, replaced: Boolean(existing) }
}

async function deleteMappingTemplateImpl(rawId: string) {
  const ctx = await requireWorkspace('pipelines:edit')
  const id = z.string().min(1).max(100).parse(rawId)
  const res = await db.delete(mappingTemplates).where(and(eq(mappingTemplates.id, id), eq(mappingTemplates.workspaceId, ctx.workspaceId))).returning({ name: mappingTemplates.name })
  if (!res.length) throw new Error('Template not found')
  await recordAudit(ctx, { action: 'DELETE', resource: 'mapping_template', resourceId: id, changes: { name: res[0].name } })
  revalidatePath('/dashboard', 'layout')
}

export async function saveMappingTemplate(...args: Parameters<typeof saveMappingTemplateImpl>) {
  return guard(() => saveMappingTemplateImpl(...args))
}

export async function deleteMappingTemplate(...args: Parameters<typeof deleteMappingTemplateImpl>) {
  return guard(() => deleteMappingTemplateImpl(...args))
}
