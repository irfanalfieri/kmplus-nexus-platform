// Client entry points for app/actions/files.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/files'
import { unwrapActions } from '@/lib/action-result'

export const { uploadFilePart, deleteFileTable } = unwrapActions(actions)
