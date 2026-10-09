// Client entry points for app/actions/pipelines.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/pipelines'
import { unwrapActions } from '@/lib/action-result'

export const { listPipelines, getBuilderOptions, listRuns, getRunRejects, listVersions, getDatasetPreview, savePipeline, setPipelineEnabled, deletePipeline, restoreVersion, runPipelineNow, cancelPipelineRun, retryPipelineRun, getRunStatus, testPipeline, resetSyncPosition } = unwrapActions(actions)
