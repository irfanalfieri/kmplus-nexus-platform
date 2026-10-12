// Client entry points for app/actions/environments.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/environments'
import { unwrapActions } from '@/lib/action-result'

export const { getEnvironments, setApprovalPolicy, setupEnvironments, linkEnvironment, unlinkEnvironment, setEnvironmentLock, previewPromotion, promotePipeline, listPromotionStatus } = unwrapActions(actions)
