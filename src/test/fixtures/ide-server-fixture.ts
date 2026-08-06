import { createMessageConnection } from 'vscode-jsonrpc/node';
import { createHash } from 'crypto';

const connection = createMessageConnection(process.stdin, process.stdout);

connection.onRequest('cs-ide/review', () => ({
  fileLevelCodeSmells: [],
  functionLevelCodeSmells: [],
  rawScore: 'raw',
  score: 9.68,
  gitBlobSha: 'review-sha',
}));
connection.onRequest('cs-ide/delta', () => ({
  fileLevelFindings: [],
  functionLevelFindings: [],
  oldScore: 10,
  newScore: 9.68,
  scoreChange: -0.32,
  oldGitBlobSha: 'old-sha',
  newGitBlobSha: 'new-sha',
}));
connection.onRequest('cs-ide/preflight', () => ({
  version: 2,
  fileTypes: ['ts'],
  languageCommon: { maxInputLoc: 100, codeSmells: ['Complex Method'] },
}));
connection.onRequest('cs-ide/fns-to-refactor', (params: { 'file-name'?: string; fileName?: string }) => {
  if (!params || typeof params !== 'object' || Array.isArray(params) || !(params['file-name'] ?? params.fileName)) {
    throw new Error('Missing file-name');
  }
  return [{
    body: 'function f() {}',
    name: 'f',
    fileType: 'TypeScript',
    functionType: 'Function',
    nippyB64: 'encoded',
    range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 16 },
    refactoringTargets: [{ category: 'Complex Method', line: 1 }],
  }];
});
connection.onRequest('cs-ide/refactor', () => ({
  code: 'function f() {}',
  confidence: {
    level: 1,
    title: 'High confidence',
    recommendedAction: { description: 'Apply', details: 'Safe change' },
    reviewHeader: 'Review',
  },
  metadata: { 'cached?': false },
  reasons: [],
  refactoringProperties: { addedCodeSmells: [], removedCodeSmells: ['Complex Method'] },
  traceId: 'trace-1',
  creditsInfo: { limit: 10, used: 1 },
}));
connection.onRequest('cs-ide/telemetry', (params) => ({ status: 202, params }));
connection.onRequest('cs-ide/device-id', () => ({ deviceId: 'device-42' }));
connection.onRequest('cs-ide/code-health-rules-template', () => ({ template: '{"rule_sets":[]}' }));
connection.onRequest('cs-ide/check-rules', () => ({ result: 'matched' }));
connection.onRequest('test/exit', () => {
  setTimeout(() => process.exit(12), 10);
  return new Promise(() => {});
});
connection.onRequest('test/never', () => new Promise(() => {}));

connection.onNotification('cs-ide/reviewFiles', ({ files, 'repo-root': repoRoot }) => {
  for (const file of files) {
    if (file.content === 'fail') {
      void connection.sendNotification('cs-ide/reviewFailed', {
        id: file.id,
        path: file['rel-path'],
        repoRoot,
        message: 'fixture review failed',
      });
      continue;
    }
    const bytes = Buffer.from(file.content, 'utf8');
    const gitBlobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    const codeSmells = file['rel-path'].endsWith('gc.cpp') ? [{
      category: 'Complex Method',
      details: 'Fixture finding',
      highlightRange: {
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 2,
      },
    }] : [];
    void connection.sendNotification('cs-ide/fileReview', {
      id: file.id,
      path: file['rel-path'],
      repoRoot,
      result: {
        fileLevelCodeSmells: codeSmells,
        functionLevelCodeSmells: [],
        rawScore: 'raw',
        score: 9.68,
        gitBlobSha,
      },
    });
    void connection.sendNotification('cs-ide/deltaReview', {
      id: file.id,
      path: file['rel-path'],
      repoRoot,
      result: {
        fileLevelFindings: [],
        functionLevelFindings: [],
        oldScore: 10,
        newScore: 9.68,
        scoreChange: -0.32,
        oldGitBlobSha: 'old-sha',
        newGitBlobSha: gitBlobSha,
      },
    });
  }
});

connection.listen();
void connection.sendNotification('cs-ide/start', {
  sha: 'fixture-sha',
  version: 'fixture-version',
  args: process.argv.slice(2),
});
