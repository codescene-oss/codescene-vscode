import * as fs from 'fs';
import * as path from 'path';
import vscode from 'vscode';
import { gitExecutor, GIT_TASK_ID } from '../git-utils';
import { isCodeHealthRulesFile } from '../utils/workspace-patterns';
import { CODE_SCENE_DIR } from './codescene-repo-config';

const CODE_HEALTH_RULES_FILE = 'code-health-rules.json';

/** Finds code-health-rules.json files without vscode.workspace.findFiles (avoids ripgrep). */
export async function discoverCodeHealthRulesFileUris(
  workspacePath: string,
  gitRootPath?: string
): Promise<vscode.Uri[]> {
  const absolutePaths = new Set<string>();

  const workspaceRules = path.join(workspacePath, CODE_SCENE_DIR, CODE_HEALTH_RULES_FILE);
  if (fs.existsSync(workspaceRules)) {
    absolutePaths.add(path.normalize(workspaceRules));
  }

  if (gitRootPath) {
    const trackedPaths = await listTrackedCodeHealthRulesPaths(gitRootPath);
    for (const relativePath of trackedPaths) {
      const absolutePath = path.normalize(path.resolve(gitRootPath, relativePath));
      if (isWithinDirectory(absolutePath, workspacePath)) {
        absolutePaths.add(absolutePath);
      }
    }
  }

  return Array.from(absolutePaths, (filePath) => vscode.Uri.file(filePath));
}

async function listTrackedCodeHealthRulesPaths(gitRootPath: string): Promise<string[]> {
  try {
    const result = await gitExecutor.execute(
      {
        command: 'git',
        args: ['ls-files', '--', ':(glob)**/.codescene/code-health-rules.json'],
        ignoreError: true,
        taskId: GIT_TASK_ID,
      },
      { cwd: gitRootPath }
    );

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return listTrackedCodeHealthRulesPathsFallback(gitRootPath);
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && isCodeHealthRulesFile(path.resolve(gitRootPath, line)));
  } catch {
    return [];
  }
}

async function listTrackedCodeHealthRulesPathsFallback(gitRootPath: string): Promise<string[]> {
  try {
    const result = await gitExecutor.execute(
      { command: 'git', args: ['ls-files'], ignoreError: true, taskId: GIT_TASK_ID },
      { cwd: gitRootPath }
    );

    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && isCodeHealthRulesFile(path.resolve(gitRootPath, line)));
  } catch {
    return [];
  }
}

function isWithinDirectory(filePath: string, directoryPath: string): boolean {
  const normalizedFile = path.normalize(filePath);
  const normalizedDirectory = path.normalize(directoryPath);
  return normalizedFile === normalizedDirectory || normalizedFile.startsWith(normalizedDirectory + path.sep);
}
