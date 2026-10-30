import { createMessageConnection, ResponseError } from 'vscode-jsonrpc/node';
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
connection.onRequest('cs-ide/telemetry', (params) => ({ status: 202, params }));
connection.onRequest('cs-ide/device-id', () => ({ deviceId: 'device-42' }));
connection.onRequest('cs-ide/code-health-rules-template', () => ({ template: '{"rule_sets":[]}' }));
let lastCheckRules: unknown;
connection.onRequest('cs-ide/check-rules', (params) => {
  lastCheckRules = params;
  return { result: 'matched' };
});
connection.onRequest('test/exit', () => {
  setTimeout(() => process.exit(12), 10);
  return new Promise(() => {});
});
connection.onRequest('test/never', () => new Promise(() => {}));

let lastWatch: unknown;
let lastStop: unknown;
connection.onRequest('test/lastWatch', () => lastWatch);
connection.onRequest('test/lastStop', () => lastStop);
connection.onRequest('test/lastCheckRules', () => lastCheckRules);

connection.onRequest('cs-ide/getWatchInventory', (params) => ({
  'repo-root': params['repo-root'],
  files: ['requested.ts'],
}));

connection.onNotification('cs-ide/watchFiles', (params) => {
  lastWatch = params;
  void connection.sendNotification('cs-ide/watchInventoryChanged', {
    'repo-root': params['repo-root'],
    files: ['watched.ts'],
  });
  void connection.sendNotification('cs-ide/fileReview', {
    path: 'watched.ts',
    repoRoot: params['repo-root'],
    result: {
      fileLevelCodeSmells: [],
      functionLevelCodeSmells: [],
      rawScore: 'raw',
      score: 9.68,
      gitBlobSha: 'watch-sha',
    },
  });
});
connection.onNotification('cs-ide/stopWatchFiles', (params) => {
  lastStop = params;
  void connection.sendNotification('cs-ide/reviewFailed', {
    path: 'stopped.ts',
    repoRoot: params['repo-root'],
    message: 'stopped',
  });
});

connection.onNotification('cs-ide/reviewFiles', ({ files, 'repo-root': repoRoot }) => {
  for (const file of files) {
    if (file.content === 'fail') {
      void connection.sendNotification('cs-ide/reviewProgress', {
        count: 0,
        done: 3,
        files: [],
      });
      void connection.sendNotification('cs-ide/reviewFailed', {
        ...(file.id ? { id: file.id } : {}),
        path: file['rel-path'],
        repoRoot,
        message: 'fixture review failed',
      });
      continue;
    }
    const content = file.content ?? '';
    const bytes = Buffer.from(content, 'utf8');
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
    void connection.sendNotification('cs-ide/reviewProgress', {
      count: 2,
      done: 1,
      files: ['b.ts', 'c.ts'],
    });
    void connection.sendNotification('cs-ide/fileReview', {
      ...(file.id ? { id: file.id } : {}),
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
    void connection.sendNotification('cs-ide/reviewProgress', {
      count: 1,
      done: 2,
      files: ['c.ts'],
    });
    void connection.sendNotification('cs-ide/deltaReview', {
      ...(file.id ? { id: file.id } : {}),
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

const signedOutStatus = {
  state: 'signed-out',
  'credential-source': null,
  'env-token-present': false,
  server: { url: 'https://codescene.io', onprem: false, source: 'default', 'pat-url': 'https://codescene.io/users/me/pat' },
  'oauth-supported': null,
  user: null,
  account: null,
  license: null,
  'ace-credential': false,
  'expires-at': null,
  login: null,
  error: null,
};
connection.onRequest('cs-ide/auth-status', () => signedOutStatus);
connection.onRequest('cs-ide/auth-token', () => ({ 'credential-source': 'oauth', 'access-token': 'fixture-access-token' }));
connection.onRequest('cs-ide/auth-configure', () => signedOutStatus);
connection.onRequest('cs-ide/auth-login', () => {
  throw new ResponseError(-32803, 'This CodeScene server does not support browser sign-in.', { code: 'auth/oauth-unsupported' });
});
connection.onRequest('test/emitAuthStatus', (status) => {
  void connection.sendNotification('cs-ide/authStatusChanged', status);
  return null;
});

connection.listen();
void connection.sendNotification('cs-ide/start', {
  sha: 'fixture-sha',
  version: 'fixture-version',
  args: process.argv.slice(2),
  ...(process.argv.includes('--auth-v1') ? { capabilities: ['auth-v1'] } : {}),
});
