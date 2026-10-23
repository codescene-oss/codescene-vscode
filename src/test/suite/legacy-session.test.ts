import * as assert from 'assert';
import { LEGACY_SESSIONS_KEY, readLegacySession } from '../../auth/legacy-session';

function secretsWith(value: string | undefined | Error) {
  return {
    get: async (key: string) => {
      if (value instanceof Error) throw value;
      return key === LEGACY_SESSIONS_KEY ? value : undefined;
    },
  };
}

suite('readLegacySession', () => {
  const stored = JSON.stringify([
    { id: 's-1', accessToken: 'legacy-1', account: { id: 'u-1', label: 'Ada' }, scopes: [], url: 'https://codescene.io', version: '1' },
  ]);
  const cases = [
    { name: 'a stored session', value: stored, expected: { accessToken: 'legacy-1', userId: 'u-1' } },
    { name: 'no stored session', value: undefined, expected: undefined },
    { name: 'malformed JSON', value: '{not json', expected: undefined },
    { name: 'a blank token', value: JSON.stringify([{ accessToken: ' ', account: { id: 'u-1' } }]), expected: undefined },
    { name: 'a failing secret store', value: new Error('locked'), expected: undefined },
  ];

  for (const { name, value, expected } of cases) {
    test(`reads ${name}`, async () => {
      assert.deepStrictEqual(await readLegacySession(secretsWith(value)), expected);
    });
  }
});
