import * as assert from 'assert';
import { reviewProgressResponse } from '../../devtools-api/rpc-response-normalizers';

suite('reviewProgressResponse', () => {
  const cases: Array<{
    name: string;
    input: unknown;
    expected: { count: number; done: number; files: string[] } | undefined;
  }> = [
    { name: 'returns undefined when progress is omitted', input: undefined, expected: undefined },
    { name: 'returns undefined when progress is null', input: null, expected: undefined },
    {
      name: 'reads count, done, and files',
      input: { count: 3, done: 1, files: ['b.js', 'c.js'] },
      expected: { count: 3, done: 1, files: ['b.js', 'c.js'] },
    },
    {
      name: 'defaults missing fields',
      input: {},
      expected: { count: 0, done: 0, files: [] },
    },
    {
      name: 'defaults a missing count to 0',
      input: { done: 2, files: ['a.js'] },
      expected: { count: 0, done: 2, files: ['a.js'] },
    },
  ];

  for (const { name, input, expected } of cases) {
    test(name, () => {
      assert.deepStrictEqual(reviewProgressResponse(input), expected);
    });
  }
});
