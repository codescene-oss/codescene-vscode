import fs from 'fs';
import path from 'path';

export const CODE_SCENE_DIR = '.codescene';
export const CONFIG_FILE_NAME = 'config.json';

interface CodesceneConfigModel {
  baseline_branch?: string;
}

/** Derives the git repository root from a `.codescene/*` file URI. */
export function gitRootFromCodesceneConfigUri(uri: { fsPath: string }): string | undefined {
  const codesceneDirPath = path.dirname(uri.fsPath);
  if (path.basename(codesceneDirPath) !== CODE_SCENE_DIR) {
    return undefined;
  }
  return path.dirname(codesceneDirPath);
}

/**
 * Reads optional baseline_branch from {gitRoot}/.codescene/config.json.
 */
export function getBaselineBranch(gitRootPath: string | undefined): string | undefined {
  if (!gitRootPath) {
    return undefined;
  }

  const configPath = path.join(
    gitRootPath.replace(/[/\\]+$/, ''),
    CODE_SCENE_DIR,
    CONFIG_FILE_NAME
  );

  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    const json = fs.readFileSync(configPath, 'utf8');
    const model = JSON.parse(json) as CodesceneConfigModel;
    const branch = model?.baseline_branch?.trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}
