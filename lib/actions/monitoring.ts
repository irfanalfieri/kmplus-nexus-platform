// Client entry points for app/actions/monitoring.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/monitoring'
import { unwrapActions } from '@/lib/action-result'

export type { PipelineHealth } from '@/app/actions/monitoring'

export const { getMonitoringOverview, listNotifications, markNotificationsRead, getOverview } = unwrapActions(actions)
