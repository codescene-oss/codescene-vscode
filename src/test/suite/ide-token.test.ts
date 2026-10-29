import * as assert from 'assert';
import { ideTokenEnv, parseIdeToken } from '../../auth/ide-token';

suite('ide-token', () => {
  const parseCases = [
    { name: 'returns the token when signed in', stdout: '{"status":"signed_in","access-token":"abc","api-url":"https://api.codescene.io"}\n', expected: 'abc' },
    { name: 'trims the token', stdout: '{"status":"signed_in","access-token":"  abc  "}', expected: 'abc' },
    { name: 'ignores a signed out session', stdout: '{"status":"signed_out"}', expected: undefined },
    { name: 'ignores a signed in session without token', stdout: '{"status":"signed_in"}', expected: undefined },
    { name: 'ignores a blank token', stdout: '{"status":"signed_in","access-token":"  "}', expected: undefined },
    { name: 'ignores invalid json', stdout: 'not json', expected: undefined },
    { name: 'ignores empty output', stdout: '', expected: undefined },
  ];

  parseCases.forEach(({ name, stdout, expected }) => {
    test(`parseIdeToken ${name}`, () => {
      assert.strictEqual(parseIdeToken(stdout), expected);
    });
  });

  const envCases = [
    { name: 'sets CS_ONPREM_URL from the server URL', serverUrl: ' https://cs.example ', expected: { KEEP: '1', CS_ONPREM_URL: 'https://cs.example' } },
    { name: 'leaves the environment alone for a blank URL', serverUrl: '  ', expected: { KEEP: '1' } },
    { name: 'leaves the environment alone for no URL', serverUrl: undefined, expected: { KEEP: '1' } },
  ];

  envCases.forEach(({ name, serverUrl, expected }) => {
    test(`ideTokenEnv ${name}`, () => {
      assert.deepStrictEqual(ideTokenEnv(serverUrl, { KEEP: '1' }), expected);
    });
  });
});
