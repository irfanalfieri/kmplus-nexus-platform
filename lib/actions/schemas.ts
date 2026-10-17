// Client entry points for app/actions/schemas.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/schemas'
import { unwrapActions } from '@/lib/action-result'

export const { getDatasetSchema, defineDatasetSchema, defineFromCurrentColumns, previewSchemaChange, changeDatasetSchema, getUpgradeNotices, dismissUpgradeNotice, listInferredDatasets } = unwrapActions(actions)
