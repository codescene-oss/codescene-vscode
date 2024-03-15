import * as assert from 'assert';
import { rankNamesBy } from '../../coupling/utils';

suite('Coupling utils Test Suite', () => {
  test('rankNamesBy - best match first', () => {
    const names = ['foo', 'bar', 'baz', 'foobar', 'bazbar'];
    const match = 'foo';
    const expected = ['foo', 'foobar', 'bar', 'baz', 'bazbar'];
    const actual = names.slice();
    rankNamesBy(match, actual);
    assert.deepStrictEqual(actual, expected);
  });

  test('rankNamesBy - case insensitive', () => {
    const names = ['foo', 'bar', 'baz', 'foobar', 'bazbar'];
    const match = 'FOO';
    const expected = ['foo', 'foobar', 'bar', 'baz', 'bazbar'];
    const actual = names.slice();
    rankNamesBy(match, actual);
    assert.deepStrictEqual(actual, expected);
  });
});
