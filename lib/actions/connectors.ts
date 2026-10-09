// Client entry points for app/actions/connectors.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/connectors'
import { unwrapActions } from '@/lib/action-result'

export const { getConnectorMarketplace, getInstalledConnectorSlugs, installConnector, purchaseConnector, uninstallConnector } = unwrapActions(actions)
