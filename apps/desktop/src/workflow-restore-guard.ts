export type WorkflowRestoreToken = {
  workflowKey: string;
  generation: number;
  activePath: string;
};

export function isCurrentWorkflowRestore(
  token: WorkflowRestoreToken,
  current: WorkflowRestoreToken,
) {
  return token.workflowKey === current.workflowKey
    && token.generation === current.generation
    && token.activePath === current.activePath;
}
