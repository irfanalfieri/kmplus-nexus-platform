// Client entry points for app/actions/audit.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/audit'
import { unwrapActions } from '@/lib/action-result'

export const { listAuditLogs } = unwrapActions(actions)
