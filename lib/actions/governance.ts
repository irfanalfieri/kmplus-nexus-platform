// Client entry points for app/actions/governance.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/governance'
import { unwrapActions } from '@/lib/action-result'

export const { getGovernanceOverview, saveDatasetPolicy, previewMaskedDataset, listErasureColumns, findErasureMatches, eraseRecords } = unwrapActions(actions)
