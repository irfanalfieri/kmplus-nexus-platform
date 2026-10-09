// Client entry points for app/actions/workspaces.ts: each action's error is thrown
// again with its real message (lib/action-result.ts). Import actions from here.
import * as actions from '@/app/actions/workspaces'
import { unwrapActions } from '@/lib/action-result'

export const { getWorkspaceContext, switchWorkspace, createWorkspace, renameWorkspace, listMembers, changeMemberRole, resetMemberTwoFactor, removeMember, createInvite, listInvites, revokeInvite, describeInvite, acceptInvite } = unwrapActions(actions)
