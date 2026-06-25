import vscode from 'vscode';
import { access } from 'fs/promises';
import { AUTH_TYPE, CsAuthenticationProvider } from './auth/auth-provider';
import {
  activate as activateCHMonitor,
  deactivate as deactivateAddon,
  getBaselineCommit,
  refreshMergeBaseBaselines,
  runGitChangeLister,
} from './code-health-monitor/addon';
import { refreshCodeHealthDetailsView } from './code-health-monitor/details/view';
import { register as registerCHRulesCommands } from './code-health-rules';
import { CodeSceneTabPanel } from './codescene-tab/webview-panel';
import { onDidChangeConfiguration, toggleReviewCodeLenses } from './configuration';
import { CsExtensionState } from './cs-extension-state';
import { DevtoolsAPI } from './devtools-api';
import CsDiagnostics from './diagnostics/cs-diagnostics';
import { register as registerDocumentationCommands } from './documentation/commands';
import { register as registerCsDocProvider } from './documentation/csdoc-provider';
import { ensureCompatibleBinary } from './download';
import { reviewDocumentSelector } from './language-support';
import { deactivate as deactivateLog, logOutputChannel, registerShowLogCommand } from './log';
import { initAce } from './refactoring';
import { register as registerCodeActionProvider } from './review/codeaction';
import { CsReviewCodeLensProvider } from './review/codelens';
import Reviewer from './review/reviewer';
import { CsServerVersion } from './server-version';
import { SavedFilesTracker } from './saved-files-tracker';
import { setupStatsCollector } from './stats';
import Telemetry from './telemetry';
import { assertError, reportError, getWorkspaceFolder } from './utils';
import { CsWorkspace } from './workspace';
import debounce = require('lodash.debounce');
import { registerCopyDeviceIdCommand } from './device-id';
import { GitChangeObserver } from './git/git-change-observer';
import { OpenFilesObserver } from './review/open-files-observer';
import { acquireGitApi, clearMainBranchCandidatesCache, deactivate as deactivateGitUtils, fireFileDeletedFromGit, getWorkspacePath } from './git-utils';
import { gitRootFromCodesceneConfigUri } from './git/codescene-repo-config';
import { DroppingScheduledExecutor } from './dropping-scheduled-executor';
import { SimpleExecutor } from './simple-executor';
import { getHomeViewInstance } from './code-health-monitor/home/home-view';
import { onGitDetectedAsUnavailable } from './git/git-detection';
import { ACE_ENABLED } from './build-flags';
import { initExtensionId } from './extension-id';
import { guardWindowLifecycleDuringTests, reloadWindowForUpdate } from './extension-reload';
import { WorkspaceFileWatcher } from './git/workspace-file-watcher';
import { discoverCodeHealthRulesFileUris } from './git/codescene-file-discovery';
import { registerGitIgnoreCacheInvalidation } from './git/git-ignore-checker';
import { isCodeHealthRulesFile, isCodesceneConfigFile } from './utils/workspace-patterns';
import { loadDocumentForBackgroundReview } from './review/review-document-loader';

export { reloadWindowForUpdate } from './extension-reload';

const ENABLE_AUTH_COMMANDS = false;

interface CsContext {
  csWorkspace: CsWorkspace;
}

let DISPOSABLES: vscode.Disposable[] = [];

const codeHealthFileVersion = new Map<string, number>();

let savedFilesTrackerInstance: SavedFilesTracker;
let openFilesObserverInstance: OpenFilesObserver | undefined;

function reReviewAfterCodeHealthRulesChange(): void {
  if (!openFilesObserverInstance) {
    return;
  }

  const visibleFiles = openFilesObserverInstance.getAllVisibleFileNames();
  const filesToReview = new Set(visibleFiles);
  const homeView = getHomeViewInstance();
  if (homeView) {
    for (const filePath of homeView.getFileIssueMap().keys()) {
      filesToReview.add(filePath);
    }
  }

  // Re-review monitor and visible files with monitor updates enabled so ignored smells are removed.
  filesToReview.forEach((filePath) => {
    const isVisible = visibleFiles.has(filePath);
    void loadDocumentForBackgroundReview(filePath, { allowOpenTextDocument: isVisible }).then((document) => {
      if (!document) {
        logOutputChannel.warn(`Failed to re-review file after rules change: ${filePath}`);
        return;
      }
      CsDiagnostics.review(document, { skipMonitorUpdate: false, updateDiagnosticsPane: isVisible });
    });
  });
}

const onCodeHealthFileVersionChange = debounce(reReviewAfterCodeHealthRulesChange, 350);

async function recordRulesFileVersion(uri: vscode.Uri): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    codeHealthFileVersion.set(document.fileName, document.version);
    onCodeHealthFileVersionChange();
  } catch (e) {
    logOutputChannel.warn(`Failed to update code-health-rules.json version: ${uri.fsPath}`, e);
  }
}

function removeRulesFileVersion(uri: vscode.Uri): void {
  codeHealthFileVersion.delete(uri.fsPath);
  onCodeHealthFileVersionChange();
}

function dispatchCodesceneFileChange(uri: vscode.Uri, event: 'upsert' | 'delete'): void {
  const filePath = uri.fsPath;
  if (isCodeHealthRulesFile(filePath)) {
    if (event === 'delete') {
      removeRulesFileVersion(uri);
    } else {
      void recordRulesFileVersion(uri);
    }
    return;
  }
  if (isCodesceneConfigFile(filePath)) {
    onCodesceneConfigChange(uri);
  }
}

const onCodesceneConfigChange = debounce((uri: vscode.Uri) => {
  const gitRoot = gitRootFromCodesceneConfigUri(uri);
  if (gitRoot) {
    clearMainBranchCandidatesCache(gitRoot);
  } else {
    clearMainBranchCandidatesCache();
  }

  refreshMergeBaseBaselines();
  void runGitChangeLister();

  if (!openFilesObserverInstance) {
    return;
  }

  const visibleFiles = openFilesObserverInstance.getAllVisibleFileNames();
  visibleFiles.forEach((filePath) => {
    const fileUri = vscode.Uri.file(filePath);
    void vscode.workspace.openTextDocument(fileUri).then(
      (document) => {
        CsDiagnostics.review(document, { skipMonitorUpdate: true, updateDiagnosticsPane: true });
      },
      (e) => {
        logOutputChannel.warn(`Failed to re-review file after config change: ${filePath}`, e);
      }
    );
  });
}, 350);

export function getCodeHealthFileVersions(): Map<string, number> {
  return codeHealthFileVersion;
}

async function initializeCodeHealthFileVersions(gitRootPath?: string) {
  const workspaceFolder = getWorkspaceFolder();
  if (!workspaceFolder) {
    return;
  }

  const workspacePath = getWorkspacePath(workspaceFolder);
  const rulesFiles = await discoverCodeHealthRulesFileUris(workspacePath, gitRootPath);

  for (const uri of rulesFiles) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      codeHealthFileVersion.set(document.fileName, document.version);
    } catch (e) {
      logOutputChannel.warn(`Failed to open code-health-rules.json: ${uri.fsPath}`, e);
    }
  }
}

/**
 * Extension entry point
 * @param context
 */
export async function activate(context: vscode.ExtensionContext) {
  guardWindowLifecycleDuringTests();
  await reloadWindowForUpdate(context);

  logOutputChannel.info('⚙️ Activating extension...');
  initExtensionId(context);
  CsExtensionState.init(context);

  ensureCompatibleBinary(context.extensionPath).then(
    async (binaryPath) => {
      DevtoolsAPI.init(binaryPath, context);
      await Telemetry.init(context);

      try {
        // Shared file-change notifications for GitChangeObserver and CachingReviewer.
        WorkspaceFileWatcher.init(context);
        // Invalidate batched gitignore cache when .gitignore files change.
        registerGitIgnoreCacheInvalidation(context);
        Reviewer.init(context, getBaselineCommit, getCodeHealthFileVersions);
        CsExtensionState.setAnalysisState({ state: 'enabled' });
        await startExtension(context);
        finalizeActivation(context);
      } catch (e) {
        CsExtensionState.setAnalysisState({ state: 'error', error: assertError(e) });
        reportError({ context: 'Unable to start extension', e });
        void vscode.commands.executeCommand('codescene.controlCenterView.focus');
      }
    },
    (e) => {
      const error = assertError(e);
      CsExtensionState.setAnalysisState({ state: 'error', error });
      reportError({ context: 'Unable to start extension', e });
      void vscode.commands.executeCommand('codescene.controlCenterView.focus');
      Telemetry.logUsage('on_activate_extension_error', { errorMessage: error.message });
    }
  );
}

async function startExtension(context: vscode.ExtensionContext) {
  const csWorkspace = new CsWorkspace(context);
  const csContext: CsContext = {
    csWorkspace,
  };
  DISPOSABLES.push(csWorkspace);
  context.subscriptions.push(csWorkspace);
  CsServerVersion.init();

  CsExtensionState.addListeners(context);
  if (ACE_ENABLED) {
    initAce(context);
  } else {
    CsExtensionState.setACEState({ state: 'disabled' });
  }

  const gitUnavailableDisposable = onGitDetectedAsUnavailable(() => {
    void vscode.window.showWarningMessage("'Git' binary not found by the CodeScene extension, or Git not initialized in this project.");
  });
  DISPOSABLES.push(gitUnavailableDisposable);
  context.subscriptions.push(gitUnavailableDisposable);

  // The DiagnosticCollection provides the squigglies and also form the basis for the CodeLenses.
  CsDiagnostics.init(context);
  createAuthProvider(context, csContext);
  registerCommands(context, csContext);
  registerCsDocProvider(context);
  savedFilesTrackerInstance = new SavedFilesTracker(context);
  savedFilesTrackerInstance.start();
  DISPOSABLES.push(savedFilesTrackerInstance);

  addReviewListeners(context);

  setupStatsCollector(context);

  activateCHMonitor(context, savedFilesTrackerInstance, () => openFilesObserverInstance?.getAllVisibleFileNames() ?? new Set());
  const gitApi = acquireGitApi();
  const workspaceFolder = getWorkspaceFolder();
  const gitRootPath = workspaceFolder && gitApi?.getRepository(workspaceFolder.uri)?.rootUri.fsPath;
  await initializeCodeHealthFileVersions(gitRootPath);

  // Add Review CodeLens support
  const codeLensProvider = new CsReviewCodeLensProvider();
  DISPOSABLES.push(codeLensProvider);
  context.subscriptions.push(codeLensProvider);
  const codeLensProviderRegistration = vscode.languages.registerCodeLensProvider(
    reviewDocumentSelector(),
    codeLensProvider
  );
  DISPOSABLES.push(codeLensProviderRegistration);
  context.subscriptions.push(codeLensProviderRegistration);

  registerCodeActionProvider(context);

  if (ACE_ENABLED) {
    // If configuration option is changed, en/disable ACE capabilities accordingly - debounce to handle rapid changes
    const debouncedSetEnabledAce = debounce((enabled: boolean) => {
      void vscode.commands.executeCommand('codescene.ace.setEnabled', enabled);
    }, 500);
    const aceConfigDisposable = onDidChangeConfiguration('enableAutoRefactor', (e) => {
      debouncedSetEnabledAce(e.value);
    });
    DISPOSABLES.push(aceConfigDisposable);
    context.subscriptions.push(aceConfigDisposable);
  }
}

/**
 * This function finalizes the activation of the extension by setting a context variable.
 * The context variable is used in package.json to conditionally enable/disable views that could
 * point to commands that haven't been fully initialized.
 */
function finalizeActivation(context: vscode.ExtensionContext) {
  // send telemetry on activation (gives us basic usage stats)
  Telemetry.logUsage('on_activate_extension');
  registerCopyDeviceIdCommand(context);
  void vscode.commands.executeCommand('setContext', 'codescene.asyncActivationFinished', true);
}

function registerCommands(context: vscode.ExtensionContext, csContext: CsContext) {
  registerShowLogCommand(context);
  registerDocumentationCommands(context);
  if (ACE_ENABLED) {
    registerOpenCsSettingsCommand(context);
  }

  const toggleReviewCodeLensesCmd = vscode.commands.registerCommand('codescene.toggleReviewCodeLenses', () => {
    toggleReviewCodeLenses();
  });
  DISPOSABLES.push(toggleReviewCodeLensesCmd);
  context.subscriptions.push(toggleReviewCodeLensesCmd);

  registerCHRulesCommands(context);
}

function registerOpenCsSettingsCommand(context: vscode.ExtensionContext) {
  const openSettingsCmd = vscode.commands.registerCommand('codescene.openSettingsAndFocusToken', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'codescene.authToken');
  });
  DISPOSABLES.push(openSettingsCmd);
  context.subscriptions.push(openSettingsCmd);
}

/**
 * Adds listeners for all events that should trigger a review.
 */
function addReviewListeners(context: vscode.ExtensionContext) {
  if (!savedFilesTrackerInstance) {
    throw new Error('SavedFilesTracker must be initialized before calling addReviewListeners');
  }

  // Observe open file events and trigger reviews
  openFilesObserverInstance = new OpenFilesObserver(context);
  openFilesObserverInstance.start();
  DISPOSABLES.push(openFilesObserverInstance);
  context.subscriptions.push(openFilesObserverInstance);

  // Watch for discrete Git file changes (create, modify, delete)
  const gitApi = acquireGitApi();
  let gitChangeObserver: GitChangeObserver | undefined;
  if (gitApi) {
    gitChangeObserver = new GitChangeObserver(context, DevtoolsAPI.concurrencyLimitingExecutor, savedFilesTrackerInstance, openFilesObserverInstance);
    gitChangeObserver.start();
    DISPOSABLES.push(gitChangeObserver);
    context.subscriptions.push(gitChangeObserver);
  }

  // Remove CHM stale files
  const filenameInspectorExecutor = new DroppingScheduledExecutor(new SimpleExecutor(), 9);
  void filenameInspectorExecutor.executeTask(async () => {
    const homeView = getHomeViewInstance();
    if (!homeView) {
      return;
    }

    const filenames = Array.from(homeView.getFileIssueMap().keys());
    if (filenames.length === 0) {
      return;
    }

    // Check each file and fire deletion event for files that don't exist
    for (const filePath of filenames) {
      try {
        await access(filePath);
      } catch {
        fireFileDeletedFromGit(filePath);
        if (gitChangeObserver) {
          gitChangeObserver.removeFromTracker(filePath);
        }
      }
    }
  });
  DISPOSABLES.push(filenameInspectorExecutor);
  context.subscriptions.push(filenameInspectorExecutor);

  registerCodesceneFileListeners(context);
}

function registerCodesceneFileListeners(context: vscode.ExtensionContext) {
  // Re-run diagnostics when .codescene/code-health-rules.json or config.json changes.
  // Uses workspace events instead of FileSystemWatcher globs to avoid ripgrep indexing.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      dispatchCodesceneFileChange(document.uri, 'upsert');
    }),
    vscode.workspace.onDidCreateFiles((event) => {
      for (const uri of event.files) {
        dispatchCodesceneFileChange(uri, 'upsert');
      }
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) {
        dispatchCodesceneFileChange(uri, 'delete');
      }
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      for (const { oldUri, newUri } of event.files) {
        dispatchCodesceneFileChange(oldUri, 'delete');
        dispatchCodesceneFileChange(newUri, 'upsert');
      }
    })
  );
}

/**
 * Activate functionality that requires signing in to a CodeScene server.
 */
function enableRemoteFeatures(context: vscode.ExtensionContext, csContext: CsContext) {}

function disableRemoteFeatures() {}

async function handleSignOut(authProvider: CsAuthenticationProvider) {
  if (CsExtensionState.session?.id) {
    await authProvider.removeSession(CsExtensionState.session.id);
    void vscode.window.showInformationMessage('Signed out from CodeScene.');
  } else {
    void vscode.window.showInformationMessage('Not signed in to CodeScene.');
  }
}

function registerSignInCommand(context: vscode.ExtensionContext, csContext: CsContext) {
  const signInCmd = vscode.commands.registerCommand('codescene.signIn', async () => {
    const existingSession = await vscode.authentication.getSession(AUTH_TYPE, [], { silent: true });
    vscode.authentication
      .getSession(AUTH_TYPE, [], { createIfNone: true })
      .then(onGetSessionSuccess(context, csContext, !!existingSession), onGetSessionError());
  });
  DISPOSABLES.push(signInCmd);
  context.subscriptions.push(signInCmd);
}

function registerSignOutCommand(context: vscode.ExtensionContext, authProvider: CsAuthenticationProvider) {
  const signOutCmd = vscode.commands.registerCommand('codescene.signOut', () => handleSignOut(authProvider));
  DISPOSABLES.push(signOutCmd);
  context.subscriptions.push(signOutCmd);
}

function createAuthProvider(context: vscode.ExtensionContext, csContext: CsContext) {
  const authProvider = new CsAuthenticationProvider(context);

  // Register manual sign in command
  if (ENABLE_AUTH_COMMANDS) {
    registerSignInCommand(context, csContext);
  }

  // Register manual sign out command
  if (ENABLE_AUTH_COMMANDS) {
    registerSignOutCommand(context, authProvider);
  }

  // If there's already a session we enable the remote features, otherwise silently add an option to
  // sign in in the accounts menu - see AuthenticationGetSessionOptions
  vscode.authentication
    .getSession(AUTH_TYPE, [], { silent: true })
    .then(onGetSessionSuccess(context, csContext), onGetSessionError());

  // Handle login/logout session changes
  const sessionsDisposable = authProvider.onDidChangeSessions((e) => {
    if (e.removed && e.removed.length > 0) {
      // Without the following getSession call, the login option in the accounts picker will not reappear!
      // This is probably refreshing the account picker under the hood
      void vscode.authentication.getSession(AUTH_TYPE, [], { silent: true });
      onGetSessionSuccess(context, csContext)(undefined); // removed a session
    }
    if (e.added && e.added.length > 0) {
      // We only have one session in this extension currently, so grabbing the first one is ok.
      onGetSessionSuccess(context, csContext)(e.added[0]);
    }
    refreshCodeHealthDetailsView();
    CodeSceneTabPanel.refreshIfExists();
  });

  const authTokenChangedDisposable = onDidChangeConfiguration('authToken', () => {
    refreshCodeHealthDetailsView();
    CodeSceneTabPanel.refreshIfExists();
    // TODO: refresh CWF view(s)
  });

  DISPOSABLES.push(authProvider);
  DISPOSABLES.push(authTokenChangedDisposable);
  DISPOSABLES.push(sessionsDisposable);
  context.subscriptions.push(authProvider, authTokenChangedDisposable, sessionsDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {
  onCodeHealthFileVersionChange.cancel();
  onCodesceneConfigChange.cancel();
  WorkspaceFileWatcher.disposeShared();
  deactivateAddon();
  deactivateGitUtils();
  deactivateLog();
  DevtoolsAPI.dispose();

  if (CsExtensionState.hasInstance) {
    CsExtensionState.dispose();
  }

  for (const disposable of DISPOSABLES) {
    try {
      disposable.dispose();
    } catch (e) {}
  }
  DISPOSABLES = [];
}

function onGetSessionSuccess(context: vscode.ExtensionContext, csContext: CsContext, showAlreadySignedIn = false) {
  return (session: vscode.AuthenticationSession | undefined) => {
    CsExtensionState.setSession(session);
    if (session) {
      if (showAlreadySignedIn) {
        void vscode.window.showInformationMessage('Already signed in to CodeScene.');
      }
      enableRemoteFeatures(context, csContext);
    } else {
      disableRemoteFeatures();
    }
  };
}

function onGetSessionError() {
  return (error: any) => {
    CsExtensionState.setSession();
    void vscode.window.showErrorMessage(`Error signing in with CodeScene: ${error}`);
  };
}
