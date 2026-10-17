// Client entry points for app/actions/finder.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/finder'
import { unwrapActions } from '@/lib/action-result'

export const { listFinderRecords } = unwrapActions(actions)
