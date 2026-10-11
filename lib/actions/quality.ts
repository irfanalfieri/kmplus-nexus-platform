// Client entry points for app/actions/quality.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/quality'
import { unwrapActions } from '@/lib/action-result'

export const { listQuarantine, getQualityOverview, fixRow, bulkFix, approveRows, dismissRows, replayRows } = unwrapActions(actions)
