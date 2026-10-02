import * as path from 'path';
import vscode from 'vscode';
import { HomeContextViewProps, IdeContextType, Job, LoginViewProps } from '../../centralized-webview-framework/types';
import { devmode, featureFlags, ideType } from '../../centralized-webview-framework/cwf-html-utils';
import { isPathUnderRoot, normalizeFsPath, relativePosix, toPosixRelPath } from '../../utils/fs-paths';

function repoRelative(fileName: string, repoRoots: readonly string[]): string | undefined {
  const normalizedFile = normalizeFsPath(fileName);
  const roots = repoRoots
    .filter((root) => isPathUnderRoot(normalizeFsPath(root), normalizedFile))
    .sort((left, right) => normalizeFsPath(right).length - normalizeFsPath(left).length);
  if (roots.length === 0) return;
  return toPosixRelPath(relativePosix(roots[0], fileName));
}

function candidatePaths(running: readonly string[]): string[] {
  return [...running, ...vscode.workspace.textDocuments.map((document) => document.fileName)];
}

function matchingAbsolutePaths(relPath: string, repoRoots: readonly string[], candidates: readonly string[]): string[] {
  const posixRel = toPosixRelPath(relPath);
  const matches = new Map<string, string>();
  for (const fileName of candidates) {
    for (const root of repoRoots) {
      if (!isPathUnderRoot(normalizeFsPath(root), normalizeFsPath(fileName))) continue;
      if (toPosixRelPath(relativePosix(root, fileName)) !== posixRel) continue;
      matches.set(normalizeFsPath(fileName), fileName);
    }
  }
  return [...matches.values()];
}

function resolveProgressFile(relPath: string, repoRoots: readonly string[], running: readonly string[]): string {
  const matches = matchingAbsolutePaths(relPath, repoRoots, candidatePaths(running));
  if (matches.length === 1) return matches[0];
  if (repoRoots.length === 1) return path.join(repoRoots[0], ...toPosixRelPath(relPath).split('/'));
  return toPosixRelPath(relPath);
}

function matchesRunning(fileName: string, relPath: string, running: readonly string[], repoRoots: readonly string[]): boolean {
  const key = normalizeFsPath(fileName);
  const posixRel = toPosixRelPath(relPath);
  return running.some((job) => normalizeFsPath(job) === key || repoRelative(job, repoRoots) === posixRel);
}

export function localJobsMissingFromProgress(
  running: Iterable<string> | undefined,
  files: readonly string[],
  repoRoots: readonly string[]
): string[] {
  const listed = new Set(files.map(toPosixRelPath));
  const missing: string[] = [];
  for (const fileName of running ?? []) {
    const relative = repoRelative(fileName, repoRoots);
    if (relative && listed.has(relative)) continue;
    missing.push(fileName);
  }
  return missing;
}

function progressJob(relPath: string, runningList: readonly string[], repoRoots: readonly string[]): Job {
  const fileName = resolveProgressFile(relPath, repoRoots, runningList);
  return {
    file: { fileName },
    type: 'deltaAnalysis',
    state: matchesRunning(fileName, relPath, runningList, repoRoots) ? 'running' : 'queued',
  };
}

function listedProgressJobs(progressFiles: readonly string[], runningList: readonly string[], repoRoots: readonly string[]): Job[] {
  const listedAbs = new Set<string>();
  const jobs: Job[] = [];
  for (const relPath of progressFiles) {
    const job = progressJob(relPath, runningList, repoRoots);
    const key = normalizeFsPath(job.file.fileName);
    if (listedAbs.has(key)) continue;
    listedAbs.add(key);
    jobs.push(job);
  }
  return jobs;
}

function appendEditorJobs(jobs: Job[], runningList: readonly string[], progressFiles: readonly string[], repoRoots: readonly string[]): void {
  const listedAbs = new Set(jobs.map((job) => normalizeFsPath(job.file.fileName)));
  for (const fileName of localJobsMissingFromProgress(runningList, progressFiles, repoRoots)) {
    if (listedAbs.has(normalizeFsPath(fileName))) continue;
    jobs.push({ file: { fileName }, type: 'deltaAnalysis', state: 'running' });
  }
}

export function analysisJobsToCwf(running?: Iterable<string>, queued?: string[], repoRoots: readonly string[] = []): Job[] {
  const runningList = running ? [...running] : [];
  const progressFiles = queued ?? [];
  const jobs = listedProgressJobs(progressFiles, runningList, repoRoots);
  appendEditorJobs(jobs, runningList, progressFiles, repoRoots);
  return jobs;
}

/**
 * Generate all needed props for CWF HomeView
 * @param param0
 * @returns
 */
export const getHomeData = ({
  fileDeltaData,
  jobs,
  autoRefactor,
  showOnboarding,
  analysisState,
  totalCount,
  remainingCount,
  signedIn,
  user,
}: HomeContextViewProps['data'] & { signedIn: boolean }): IdeContextType => {
  return {
    ideType: ideType,
    view: 'home',
    devmode: devmode,
    pro: signedIn,
    featureFlags: featureFlags,
    data: {
      fileDeltaData,
      jobs,
      autoRefactor,
      showOnboarding,
      analysisState,
      totalCount,
      remainingCount,
      user,
    },
  };
};

/**
 * Generate all needed props for LoginView
 * @param param0
 * @returns
 */
export const getLoginData = ({ baseUrl, state, availableProjects, user }: LoginViewProps['data']) => {
  return {
    ideType: ideType,
    view: 'login',
    devmode: devmode,
    pro: false,
    featureFlags: featureFlags,
    data: {
      baseUrl,
      state,
      availableProjects,
      user,
    },
  };
};
