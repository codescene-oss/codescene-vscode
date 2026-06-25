let activitySinceLastScan = false;

export function markWorkspaceFileActivity(): void {
  activitySinceLastScan = true;
}

export function consumeWorkspaceFileActivity(): boolean {
  const hadActivity = activitySinceLastScan;
  activitySinceLastScan = false;
  return hadActivity;
}

export function resetWorkspaceFileActivity(): void {
  activitySinceLastScan = false;
}
