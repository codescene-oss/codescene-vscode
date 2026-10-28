import * as assert from 'assert';
import { redactSecrets } from '../../log-redaction';

suite('redactSecrets', () => {
  const cases = [
    { name: 'bearer header', input: 'Authorization: Bearer abc.def-123', expected: 'Authorization: Bearer <redacted>' },
    {
      name: 'kebab JSON key',
      input: '{"access-token":"pat-123","server-url":null}',
      expected: '{"access-token":"<redacted>","server-url":null}',
    },
    { name: 'EDN key', input: '{:refresh-token "r-456"}', expected: '{:refresh-token "<redacted>"}' },
    { name: 'query parameter', input: 'refresh_token=r-456&state=x', expected: 'refresh_token=<redacted>&state=x' },
    { name: 'text without secrets', input: 'review done path=a.ts', expected: 'review done path=a.ts' },
  ];

  for (const { name, input, expected } of cases) {
    test(`redacts ${name}`, () => {
      assert.strictEqual(redactSecrets(input), expected);
    });
  }
});
