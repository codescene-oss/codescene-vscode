import * as fs from 'fs';
import * as path from 'path';
import { ReviewPipelineFileAccess, ReviewPipelinePresentation } from '../../review/review-pipeline';
import { TestTextDocument } from '../../test/mocks/test-text-document';

const LANGUAGE_IDS: Record<string, string> = {
  '.java': 'java',
  '.kt': 'kotlin',
  '.ts': 'typescript',
  '.js': 'javascript',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.py': 'python',
};

export function languageIdFor(relPath: string): string {
  return LANGUAGE_IDS[path.extname(relPath).toLowerCase()] ?? 'plaintext';
}

export function documentFor(repoRoot: string, relPath: string, content: string): TestTextDocument {
  return new TestTextDocument(path.join(repoRoot, ...relPath.split('/')), content, languageIdFor(relPath));
}

export function silentPresentation(): ReviewPipelinePresentation {
  return {
    reviewStarted: () => {},
    reviewFinished: () => {},
    deltaStarted: () => {},
    deltaFinished: () => {},
    presentReview: () => {},
    presentDelta: () => {},
    remove: () => {},
    failed: () => {},
  };
}

export function diskFileAccess(): ReviewPipelineFileAccess {
  return {
    findOpenDocument: () => undefined,
    openDocument: (filePath: string) =>
      Promise.resolve(new TestTextDocument(filePath, fs.readFileSync(filePath, 'utf8'), languageIdFor(filePath))),
    readFileBytes: async (filePath: string) => {
      try {
        return await fs.promises.readFile(filePath);
      } catch {
        return undefined;
      }
    },
    isVisible: () => false,
  };
}
