/**
 * Interface to various git functions.
 *
 * It keeps track of changes to the git change set and emits an event when it changes. This
 * is used to refresh e.g. the couplings view in the SCM panel.
 */
import * as vscode from 'vscode';
import { SimpleExecutor } from './executor';
import { dirname } from 'path';
import debounce = require('lodash.debounce');

export class Git implements vscode.Disposable {
  private changeSetModifiedEmitter = new vscode.EventEmitter<void>();
  private gitIgnoreCache = new Map<string, boolean>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
    watcher.onDidChange(() => this.clearIgnoreCache());
    watcher.onDidCreate(() => this.clearIgnoreCache());
    watcher.onDidDelete(() => this.clearIgnoreCache());

    const debouncedFire = debounce(() => this.changeSetModifiedEmitter.fire(), 2500);

    const fileWatcherCallback = async (file: vscode.Uri) => {
      if (await this.isIgnored(file, { throwOnFailure: true })) {
        return;
      }
      debouncedFire();
    };

    // This can be a very noisy file watcher! We need to take care!
    const fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables.push(fileSystemWatcher.onDidChange(fileWatcherCallback));
    this.disposables.push(fileSystemWatcher.onDidCreate(fileWatcherCallback));
    this.disposables.push(fileSystemWatcher.onDidDelete(fileWatcherCallback));

    const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/index*');
    this.disposables.push(gitWatcher.onDidCreate(debouncedFire));
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  /**
   * Fires when the files under git control have changed.
   *
   * This is somewhat of a best effort.
   */
  get onDidModifyChangeSet() {
    return this.changeSetModifiedEmitter.event;
  }

  private clearIgnoreCache() {
    this.gitIgnoreCache = new Map<string, boolean>();
  }

  async changeSet() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const changeSet = new Set<string>();

    if (!workspaceFolders) return changeSet;

    const executor = new SimpleExecutor();

    for (const workspaceFolder of workspaceFolders) {
      const workspacePath = workspaceFolder.uri.fsPath;

      const result = await executor.execute(
        { command: 'git', args: ['diff', '--name-only'], ignoreError: true },
        { cwd: workspacePath }
      );

      if (result.exitCode !== 0) {
        console.log(`git diff failed with exit code ${result.exitCode}`);
        continue;
      }

      const files = result.stdout
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);

      const repoRootName = await this.repoRootNameFromDirectory(workspacePath);

      for (const file of files) {
        changeSet.add(`${repoRootName}/${file}`);
      }
    }

    return changeSet;
  }

  async isIgnored(file: vscode.Uri | vscode.TextDocument, opts = { throwOnFailure: false }) {
    const executor = new SimpleExecutor();

    let filePath;
    if (file instanceof vscode.Uri) {
      filePath = file.fsPath;
    } else {
      filePath = file.uri.fsPath;
    }

    if (this.gitIgnoreCache.has(filePath)) {
      return this.gitIgnoreCache.get(filePath);
    }

    const result = await executor.execute(
      { command: 'git', args: ['check-ignore', filePath], ignoreError: true },
      { cwd: dirname(filePath) }
    );

    // This happens when the file is not in a git repository.
    if (opts.throwOnFailure && result.exitCode === 128) {
      throw new Error(`git check-ignore failed with exit code ${result.exitCode}`);
    }

    const ignored = result.exitCode === 0;

    this.gitIgnoreCache.set(filePath, ignored);

    return ignored;
  }

  async repoRootFromDirectory(dir: string) {
    const executor = new SimpleExecutor();

    const result = await executor.execute({ command: 'git', args: ['rev-parse', '--show-toplevel'] }, { cwd: dir });

    if (result.exitCode !== 0) {
      throw new Error(`git rev-parse failed with exit code ${result.exitCode}`);
    }

    return result.stdout.trim();
  }

  async repoRootNameFromDirectory(dir: string) {
    const repoRoot = await this.repoRootFromDirectory(dir);
    return repoRoot.split('/').pop();
  }
}
