// Client entry points for app/actions/analytics.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/analytics'
import { unwrapActions } from '@/lib/action-result'

export const { getAnalyticsDatasets, listDashboards, saveDashboard, deleteDashboard, previewWidget, getDashboardData } = unwrapActions(actions)
