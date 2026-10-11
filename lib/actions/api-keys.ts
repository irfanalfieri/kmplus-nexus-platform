// Client entry points for app/actions/api-keys.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/api-keys'
import { unwrapActions } from '@/lib/action-result'

export const { listApiKeys, createApiKey, revokeApiKey } = unwrapActions(actions)
