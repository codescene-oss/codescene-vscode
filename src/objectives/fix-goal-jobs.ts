import * as nodePath from 'path';
import vscode from 'vscode';
import type { Job } from '../centralized-webview-framework/types';

function jobKey(goalId: number, fileName: string): string {
  const normalized = nodePath.normalize(fileName);
  return `${goalId}:${process.platform === 'win32' ? normalized.toLowerCase() : normalized}`;
}

export class FixGoalJobs implements vscode.Disposable {
  private readonly jobsByKey = new Map<string, Job>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.changeEmitter.event;

  get jobs(): Job[] {
    return [...this.jobsByKey.values()];
  }

  has(goalId: number, fileName: string): boolean {
    return this.jobsByKey.has(jobKey(goalId, fileName));
  }

  add(goalId: number, fileName: string): boolean {
    const key = jobKey(goalId, fileName);
    if (this.jobsByKey.has(key)) return false;
    this.jobsByKey.set(key, { type: 'fixGoal', goalId, state: 'running', file: { fileName } });
    this.changeEmitter.fire();
    return true;
  }

  remove(goalId: number, fileName: string): void {
    if (this.jobsByKey.delete(jobKey(goalId, fileName))) this.changeEmitter.fire();
  }

  clear(): void {
    if (this.jobsByKey.size === 0) return;
    this.jobsByKey.clear();
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

export const fixGoalJobs = new FixGoalJobs();
