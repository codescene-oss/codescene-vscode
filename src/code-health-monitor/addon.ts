import vscode, { Uri } from 'vscode';
import { API, Branch, GitExtension, Repository } from '../../types/git';
import Reviewer from '../review/reviewer';
import { register as registerCodeLens } from './codelens';
import { register as registerCodeHealthDetailsView } from './details/view';
import { Baseline, CodeHealthMonitorView } from './tree-view';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logOutputChannel } from '../log';

let gitApi: API | undefined;
let currentBaseline: string | undefined;

export function activate(context: vscode.ExtensionContext) {
  gitApi = acquireGitApi();
  if (!gitApi) return;

  currentBaseline = context.globalState.get('baseline');

  const codeHealthMonitorView = new CodeHealthMonitorView(context);
  registerCodeLens(context);
  registerCodeHealthDetailsView(context);

  const repoStateListeners = gitApi.repositories.map((repo) => repo.state.onDidChange(() => onRepoStateChange(repo)));

  codeHealthMonitorView.onBaselineChanged(() => {
    currentBaseline = context.globalState.get('baseline');
    Reviewer.instance.refreshAllDeltasAndBaselines();
  });

  context.subscriptions.push(
    codeHealthMonitorView,
    ...repoStateListeners,
    vscode.commands.registerCommand('codescene.codeHealthMonitorHelp', () => {
      void vscode.commands.executeCommand(
        'markdown.showPreviewToSide',
        vscode.Uri.parse(`csdoc:code-health-monitor.md`)
      );
    })
  );
}

function acquireGitApi() {
  const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports as GitExtension;
  if (!gitExtension) {
    void vscode.window.showErrorMessage(
      'Unable to load vscode.git extension. Code Health Monitor will be unavailable.'
    );
    return;
  }
  return gitExtension.getAPI(1);
}

const repoState = new Map<string, Branch>();

export async function getBaselineCommit(fileUri: Uri): Promise<string | undefined> {
  if (currentBaseline === Baseline.Head) return 'HEAD';

  return await getBranchCreationPoint(fileUri);
}

const execAsync = promisify(exec);

/**
 * Retrieves the commit hash where the current branch was created from, based on the file URI.
 * @param fileUri - The URI of the file in the repository.
 * @returns The commit hash of the branch creation point or undefined if not found.
 */
async function getBranchCreationPoint(fileUri: Uri) {
  if (!gitApi) return;

  try {
    const CREATION_KEYWORD = 'created from';
    const currentRepo = gitApi.getRepository(fileUri);
    const repositoryPath = currentRepo?.rootUri.path;
    if (!repositoryPath) return;

    const { stdout: branchName } = await execAsync(`git rev-parse --abbrev-ref HEAD`, { cwd: repositoryPath });
    const { stdout: reflog } = await execAsync(`git reflog ${branchName.trim()} --no-abbrev`, { cwd: repositoryPath });

    return reflog
      .split('\n')
      .reverse()
      .find((line) => line.toLowerCase().includes(CREATION_KEYWORD))
      ?.split(' ')?.[0];
  } catch (err) {
    logOutputChannel.error(`Error occurred while retrieving branch creation point for file ${fileUri.fsPath}: ${err}`);
    return undefined;
  }
}

/**
 * Listens for changes in a repository's state and resets the
 * baseline review/score for all changed files.
 * @param repo
 */
function onRepoStateChange(repo: Repository) {
  if (currentBaseline == Baseline.BranchCreation) {
    handleBranchCreationBaselineChange(repo);
  } else {
    handleHeadBaselineChange(repo);
  }
}

/**
 * Handles baseline changes when the baseline is set to branch creation.
 * @param repo - The repository whose state has changed.
 */
async function handleBranchCreationBaselineChange(repo: Repository) {
  const first = await getBranchCreationPoint(repo.rootUri);
  const second = repo.state.HEAD?.commit;

  const shouldDiff = first && second && first !== second;
  if (!shouldDiff) return;

  const changes = await repo.diffBetween(first, second);
  changes.forEach((change) => Reviewer.instance.reviewCache.resetBaseline(change.uri.fsPath));
}

/**
 * Handles baseline changes when the baseline is set to HEAD.
 * @param repo - The repository whose state has changed.
 */
function handleHeadBaselineChange(repo: Repository) {
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
