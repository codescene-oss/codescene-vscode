/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import { kebabCase, kebabKeys } from '../../utils/kebab-keys';

suite('kebabKeys Test Suite', () => {
  test('kebabCase converts camelCase and acronyms and leaves kebab-case alone', () => {
    assert.strictEqual(kebabCase('scoreChange'), 'score-change');
    assert.strictEqual(kebabCase('nIssues'), 'n-issues');
    assert.strictEqual(kebabCase('HTTPStatus'), 'http-status');
    assert.strictEqual(kebabCase('common.nodeArch'), 'common.node-arch');
    assert.strictEqual(kebabCase('event-name'), 'event-name');
    assert.strictEqual(kebabCase('visible'), 'visible');
  });

  test('converts keys at every depth, through arrays', () => {
    assert.deepStrictEqual(kebabKeys({ extraData: { repoRoot: '/r', retryCounts: [{ fileName: 'a.ts' }, 2] } }), {
      'extra-data': { 'repo-root': '/r', 'retry-counts': [{ 'file-name': 'a.ts' }, 2] },
    });
  });

  test('keeps values that are not plain objects or arrays', () => {
    const date = new Date(0);
    class Box {
      innerValue = 1;
    }
    const box = new Box();
    assert.deepStrictEqual(kebabKeys({ someDate: date, someBox: box, nothing: null, text: 'camelCase' }), {
      'some-date': date,
      'some-box': box,
      nothing: null,
      text: 'camelCase',
    });
    assert.strictEqual(kebabKeys(undefined), undefined);
    assert.strictEqual(kebabKeys('aB'), 'aB');
  });

  test('does not mutate its input', () => {
    const input = { scoreChange: 1 };
    kebabKeys(input);
    assert.deepStrictEqual(input, { scoreChange: 1 });
  });
});
