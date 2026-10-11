// Client entry points for app/actions/webhooks.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/webhooks'
import { unwrapActions } from '@/lib/action-result'

export const { listWebhooks, createWebhook, updateWebhook, deleteWebhook, testWebhook } = unwrapActions(actions)
