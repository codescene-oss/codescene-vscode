import * as path from 'path';
import { supportedExtensions } from '../language-support';
import { CODE_SCENE_DIR, CONFIG_FILE_NAME } from '../git/codescene-repo-config';

const CODE_HEALTH_RULES_FILE = 'code-health-rules.json';

export function normalizePathForMatch(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/');
}

export function isSupportedSourceFile(filePath: string): boolean {
  const fileExt = path.extname(filePath);
  return !!fileExt && supportedExtensions.includes(fileExt);
}

export function isGitignoreFile(filePath: string): boolean {
  return path.basename(filePath) === '.gitignore';
}

export function isCodeHealthRulesFile(filePath: string): boolean {
  const normalized = normalizePathForMatch(filePath);
  return normalized.endsWith(`/${CODE_SCENE_DIR}/${CODE_HEALTH_RULES_FILE}`);
}

export function isCodesceneConfigFile(filePath: string): boolean {
  const normalized = normalizePathForMatch(filePath);
  return normalized.endsWith(`/${CODE_SCENE_DIR}/${CONFIG_FILE_NAME}`);
}
