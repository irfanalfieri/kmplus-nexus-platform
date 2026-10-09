// Client entry points for app/actions/connector-source.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/connector-source'
import { unwrapActions } from '@/lib/action-result'

export const { testConnectorConnectionAction, scanConnectorSchemaAction, scanDataSourceSchema, getDataSourceTableSample, previewRestConnection, testAndScanDataSource } = unwrapActions(actions)
