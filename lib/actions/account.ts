// Client entry points for app/actions/account.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/account'
import { unwrapActions } from '@/lib/action-result'

export const { getAccountSecurity } = unwrapActions(actions)
