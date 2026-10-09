// Client entry points for app/actions/salesforce-oauth.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/salesforce-oauth'
import { unwrapActions } from '@/lib/action-result'

export const { startSalesforceWebAuth } = unwrapActions(actions)
