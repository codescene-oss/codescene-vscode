import * as assert from 'assert';
import { authErrorCode, AuthRpc, isMethodNotFound } from '../../auth/auth-rpc';
import { authRpcError, FakeAuthTransport } from '../fakes/fake-auth-transport';

suite('AuthRpc', () => {
  const repoPath = 'C:\\git\\acme-backend';
  const cases: Array<{ name: string; call: (rpc: AuthRpc) => Promise<unknown>; method: string; params: unknown }> = [
    {
      name: 'configure',
      call: (rpc) => rpc.configure({ 'server-url': 'https://cs.example', 'access-token': null }),
      method: 'cs-ide/auth-configure',
      params: { 'server-url': 'https://cs.example', 'access-token': null },
    },
    { name: 'status', call: (rpc) => rpc.status(), method: 'cs-ide/auth-status', params: {} },
    { name: 'login', call: (rpc) => rpc.login(), method: 'cs-ide/auth-login', params: {} },
    {
      name: 'cancelLogin',
      call: (rpc) => rpc.cancelLogin('3f1c9a2e'),
      method: 'cs-ide/auth-cancel-login',
      params: { 'login-id': '3f1c9a2e' },
    },
    { name: 'logout', call: (rpc) => rpc.logout(), method: 'cs-ide/auth-logout', params: {} },
    { name: 'listAccounts', call: (rpc) => rpc.listAccounts(), method: 'cs-ide/auth-list-accounts', params: {} },
    {
      name: 'selectAccount',
      call: (rpc) => rpc.selectAccount('7'),
      method: 'cs-ide/auth-select-account',
      params: { 'account-id': '7' },
    },
    {
      name: 'syncAccount',
      call: (rpc) => rpc.syncAccount(repoPath),
      method: 'cs-ide/auth-sync-account',
      params: { 'repo-path': repoPath },
    },
    { name: 'listProjects', call: (rpc) => rpc.listProjects(), method: 'cs-ide/projects-list', params: {} },
    {
      name: 'getProjectLink',
      call: (rpc) => rpc.getProjectLink(repoPath),
      method: 'cs-ide/project-link-get',
      params: { 'repo-path': repoPath },
    },
    {
      name: 'setProjectLink',
      call: (rpc) => rpc.setProjectLink(repoPath, null),
      method: 'cs-ide/project-link-set',
      params: { 'repo-path': repoPath, 'project-id': null },
    },
  ];

  for (const { name, call, method, params } of cases) {
    test(`${name} sends ${method}`, async () => {
      const transport = new FakeAuthTransport().respond(method, () => 'result');
      assert.strictEqual(await call(new AuthRpc(transport)), 'result');
      assert.deepStrictEqual(transport.requests, [{ method, params }]);
    });
  }

  suite('authErrorCode', () => {
    const errorCases = [
      { name: 'an auth error', error: authRpcError('auth/invalid-token'), expected: 'auth/invalid-token' },
      { name: 'invalid params', error: Object.assign(new Error('bad'), { code: -32602 }), expected: undefined },
      { name: 'a plain error', error: new Error('boom'), expected: undefined },
      { name: 'undefined', error: undefined, expected: undefined },
    ];

    for (const { name, error, expected } of errorCases) {
      test(`reads ${name}`, () => {
        assert.strictEqual(authErrorCode(error), expected);
      });
    }
  });

  suite('isMethodNotFound', () => {
    test('recognises a JSON-RPC method-not-found error', () => {
      assert.deepStrictEqual(
        [
          isMethodNotFound(Object.assign(new Error('Method not found'), { code: -32601 })),
          isMethodNotFound(Object.assign(new Error('bad'), { code: -32602 })),
          isMethodNotFound(new Error('boom')),
          isMethodNotFound(undefined),
        ],
        [true, false, false, false]
      );
    });
  });
});
