// Client entry points for app/actions/supabase-source.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/supabase-source'
import { unwrapActions } from '@/lib/action-result'

export const { testSupabaseConnectionAction, scanSupabaseSchemaAction, scanSupabaseSourceSchema, getSupabaseTableSampleAction, updateSupabaseSourceCredentials } = unwrapActions(actions)
