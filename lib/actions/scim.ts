// Client entry points for app/actions/scim.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/scim'
import { unwrapActions } from '@/lib/action-result'

export const { getScimOverview, createScimToken, revokeScimToken, setScimGroupRole } = unwrapActions(actions)
