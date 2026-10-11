// Client entry points for app/actions/sso.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/sso'
import { unwrapActions } from '@/lib/action-result'

export const { listSsoProviders, createSsoProvider, verifySsoDomain, updateSsoProvider, deleteSsoProvider } = unwrapActions(actions)
