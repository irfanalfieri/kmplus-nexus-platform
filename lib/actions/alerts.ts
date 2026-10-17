// Client entry points for app/actions/alerts.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/alerts'
import { unwrapActions } from '@/lib/action-result'

export const { listAlertChannels, createAlertChannel, updateAlertChannel, deleteAlertChannel, testAlertChannel, getPipelineAlerts, savePipelineAlerts, setPipelineSubscription } = unwrapActions(actions)
