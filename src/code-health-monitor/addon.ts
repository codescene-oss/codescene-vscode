import vscode from 'vscode';
import { Branch, GitExtension, Repository } from '../../types/git';
import Reviewer from '../review/reviewer';
import { register as registerCodeHealthDetailsView } from './details/view';
import { CodeHealthMonitorView } from './tree-view';

export function activate(context: vscode.ExtensionContext) {
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports as GitExtension;
  if (!gitExtension) {
    void vscode.window.showErrorMessage(
      'Unable to load vscode.git extension. Code Health Monitor will be unavailable.'
    );
    return;
  }

  const codeHealthMonitorView = new CodeHealthMonitorView(context);
  registerCodeHealthDetailsView(context);

  const gitApi = gitExtension.getAPI(1);
  const repoStateListeners = gitApi.repositories.map((repo) => repo.state.onDidChange(() => onRepoStateChange(repo)));

  context.subscriptions.push(
    codeHealthMonitorView,
    ...repoStateListeners,
    vscode.commands.registerCommand('codescene-noace.codeHealthMonitorHelp', () => {
      void vscode.commands.executeCommand(
        'markdown.showPreviewToSide',
        vscode.Uri.parse(`csdoc:code-health-monitor.md`)
      );
    })
  );
}

const repoState = new Map<string, Branch>();

/**
 * Listens for changes in a repository's state. If the HEAD commit changes, we will reset the
 * baseline review/score for all changed files.
 * @param repo
 */
function onRepoStateChange(repo: Repository) {
  if (!repo.state.HEAD) return;
  const headRef = { ...repo.state.HEAD };
  const prevRef = repoState.get(repo.rootUri.fsPath);
  if (!prevRef) {
    repoState.set(repo.rootUri.fsPath, headRef);
    return;
  }
  if (prevRef.commit === headRef.commit) return;

  void resetBaselineForFilesChanged(headRef, prevRef, repo);
  repoState.set(repo.rootUri.fsPath, headRef);
}

async function resetBaselineForFilesChanged(headRef: Branch, prevRef: Branch, repo: Repository) {
  // Need the refs sorted by "ahead" to get them in the required order for the diffBetween call
  // The command run by the git vscode extension is 'git diff first...second'
  const [ref1, ref2] = [headRef, prevRef].sort((a, b) => Number(a.ahead) - Number(b.ahead));
  if (ref1.commit && ref2.commit) {
    const changes = await repo.diffBetween(ref1.commit, ref2.commit);
    changes.forEach((change) => {
      // TODO - do we need special handling for added/deleted files?
      // if (change.status === Status.DELETED) return;
      Reviewer.instance.reviewCache.resetBaseline(change.uri.fsPath);
    });
  }
}
