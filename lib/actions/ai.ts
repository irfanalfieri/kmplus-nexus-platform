// Client entry points for app/actions/ai.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/ai'
import { unwrapActions } from '@/lib/action-result'

export const { getAiSettings, setAiProvider, suggestMapping, draftRule, askData, draftPipeline, diagnoseRun, applyDiagnosisFix, suggestConnector } = unwrapActions(actions)
