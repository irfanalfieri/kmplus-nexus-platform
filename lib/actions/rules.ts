// Client entry points for app/actions/rules.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/rules'
import { unwrapActions } from '@/lib/action-result'

export const { listRules, listRuleVersions, saveRule, deleteRule, testRule } = unwrapActions(actions)
