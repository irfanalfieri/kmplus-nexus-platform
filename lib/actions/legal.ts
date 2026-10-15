// Client entry points for app/actions/legal.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/legal'
import { unwrapActions } from '@/lib/action-result'

export const { acceptTerms } = unwrapActions(actions)
