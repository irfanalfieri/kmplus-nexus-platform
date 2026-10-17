// Client entry points for app/actions/pipeline-transfer.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/pipeline-transfer'
import { unwrapActions } from '@/lib/action-result'

export const { exportPipeline, previewImport, importPipeline } = unwrapActions(actions)
