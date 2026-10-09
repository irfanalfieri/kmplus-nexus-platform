// Client entry points for app/actions/data-sources.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/data-sources'
import { unwrapActions } from '@/lib/action-result'

export const { getDataSources, createDataSource, testConnection, getEditableCredentials, updateDataSourceCredentials, renameDataSource, setDataSourceRole, deleteDataSource } = unwrapActions(actions)
