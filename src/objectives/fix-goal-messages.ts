import * as vscode from 'vscode';
import * as nodePath from 'path';
import type { ObjectivesSnapshot } from '../centralized-webview-framework/types/objectives';
import type { FixGoalTarget } from '../refactoring/agent-types';

export function resolveFixGoalTarget(
  snapshot: ObjectivesSnapshot | undefined,
  goalId: number,
  path: string
): FixGoalTarget | string {
  if (!snapshot) return 'goal-not-found';

  const objective = snapshot.objectives.find((obj) => obj.kind === 'goal' && obj.id === goalId);
  if (!objective) return 'goal-not-found';

  const file = objective.local?.files?.find((f) => f.path === path);
  if (!file) return 'file-not-in-goal';

  if (file.result !== 'violated') return 'not-violated';

  if (file.value === undefined || file['comparison-value'] === undefined) return 'no-scores';

  return {
    goalId,
    metricId: objective['metric-id'],
    operator: objective.threshold.operator,
    target: file['comparison-value'],
    baseline: file.value,
    repoRoot: snapshot['repo-root'],
    path,
  };
}

export interface FixGoalDeps {
  snapshot: () => ObjectivesSnapshot | undefined;
  enabled: () => boolean;
  openDocument: (fsPath: string) => Thenable<vscode.TextDocument>;
  executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
  log: (message: string) => void;
}

export async function handleFixGoal(goalId: number, path: string, deps: FixGoalDeps): Promise<void> {
  if (!deps.enabled()) {
    deps.log(`[fix-goal] Ignoring goal ${goalId}: the Refactoring Agent is not enabled`);
    return;
  }

  const target = resolveFixGoalTarget(deps.snapshot(), goalId, path);
  if (typeof target === 'string') {
    deps.log(`[fix-goal] Ignoring goal ${goalId} ${path}: ${target}`);
    return;
  }

  let document: vscode.TextDocument;
  try {
    document = await deps.openDocument(nodePath.join(target.repoRoot, target.path));
  } catch (error) {
    deps.log(`[fix-goal] Failed to open document for goal ${goalId} ${path}: ${error}`);
    return;
  }

  await deps.executeCommand('codescene.requestAndPresentRefactoring', document, 'objectives', undefined, false, undefined, target);
}
