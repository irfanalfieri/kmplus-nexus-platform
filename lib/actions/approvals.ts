// Client entry points for app/actions/approvals.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/approvals'
import { unwrapActions } from '@/lib/action-result'

export const { listApprovals, approveRequest, rejectRequest, cancelRequest } = unwrapActions(actions)
