export function normalizeSidebarCollapsedState(
  workspaceIds: string[],
  activeWorkspaceId: string | null,
  previousCollapsed: Record<string, boolean>,
  previousActiveWorkspaceId: string | null,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  const activeWorkspaceChanged = activeWorkspaceId !== previousActiveWorkspaceId;
  const hasActiveWorkspace =
    typeof activeWorkspaceId === "string" && workspaceIds.includes(activeWorkspaceId);

  // When the active workspace changes, ensure the new active one is expanded
  // but leave other projects' collapsed state as-is (multi-expand support).
  if (activeWorkspaceChanged && hasActiveWorkspace && activeWorkspaceId) {
    for (const workspaceId of workspaceIds) {
      if (workspaceId === activeWorkspaceId) {
        next[workspaceId] = false; // always expand the newly active one
      } else if (workspaceId in previousCollapsed) {
        next[workspaceId] = previousCollapsed[workspaceId];
      } else {
        next[workspaceId] = true; // new workspaces default collapsed
      }
    }
    return next;
  }

  for (const workspaceId of workspaceIds) {
    if (workspaceId in previousCollapsed) {
      next[workspaceId] = previousCollapsed[workspaceId];
      continue;
    }

    next[workspaceId] = hasActiveWorkspace ? workspaceId !== activeWorkspaceId : false;
  }

  return next;
}
