import vscode from 'vscode';
import { FnToRefactor } from './refactor-models';
import { CodeSmell } from './review-model';
import { DevtoolsAPI } from '.';
import { logOutputChannel } from '../log';
import { basename } from 'path';

/**
 * Shared cache for fnsToRefactor results to avoid redundant binary calls.
 * Key format: <uri>:v<version>:<line>:<character>:<category>
 */
class FnsToRefactorCache {
  private cache = new Map<string, FnToRefactor | undefined>();

  // Kept private in order to enforce use of the caching layer.
  private async fnsToRefactorFromCodeSmell(
    document: vscode.TextDocument,
    codeSmell: CodeSmell
  ): Promise<FnToRefactor | undefined> {
    const result = await (DevtoolsAPI as any).fnsToRefactor(document, ['--code-smells', JSON.stringify([codeSmell])]);
    return result?.[0];
  }

  private buildCacheKey(document: vscode.TextDocument, codeSmell: CodeSmell): string {
    const line = codeSmell['highlight-range']['start-line'];
    const character = codeSmell['highlight-range']['start-column'];
    return `${document.uri.toString()}:v${document.version}:${line}:${character}:${codeSmell.category}`;
  }

  async fnsToRefactor(document: vscode.TextDocument, codeSmell: CodeSmell): Promise<FnToRefactor | undefined> {
    const cacheKey = this.buildCacheKey(document, codeSmell);

    const cached = this.cache.get(cacheKey);
    if (this.cache.has(cacheKey)) {
      return cached;
    }

    const result = await this.fnsToRefactorFromCodeSmell(document, codeSmell);
    this.cache.set(cacheKey, result);
    return result;
  }

  private isStaleEntry(key: string, docUri: string, currentVersion: number): boolean {
    if (!key.startsWith(docUri + ':v')) {
      return false;
    }

    const versionMatch = key.match(/:v(\d+):/);
    if (!versionMatch) {
      return false;
    }

    const cachedVersion = parseInt(versionMatch[1], 10);
    return cachedVersion < currentVersion;
  }

  invalidateForDocument(document: vscode.TextDocument): void {
    const docUri = document.uri.toString();
    const currentVersion = document.version;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (this.isStaleEntry(key, docUri, currentVersion)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  cleanupForDocument(document: vscode.TextDocument): void {
    const docUri = document.uri.toString();
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(docUri + ':v')) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
  }

}

export const fnsToRefactorCache = new FnsToRefactorCache();
