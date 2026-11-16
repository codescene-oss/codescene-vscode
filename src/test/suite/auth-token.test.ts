import * as assert from 'assert';
import { tokenFromResponse } from '../../auth/auth-token';

suite('tokenFromResponse', () => {
  const cases = [
    { name: 'returns the token', response: { 'credential-source': 'oauth' as const, 'access-token': 'abc' }, expected: 'abc' },
    { name: 'trims the token', response: { 'access-token': '  abc  ' }, expected: 'abc' },
    { name: 'ignores a blank token', response: { 'access-token': '  ' }, expected: undefined },
    { name: 'ignores a missing token', response: {}, expected: undefined },
    { name: 'ignores a missing response', response: undefined, expected: undefined },
  ];

  cases.forEach(({ name, response, expected }) => {
    test(name, () => {
      assert.strictEqual(tokenFromResponse(response), expected);
    });
  });
});
