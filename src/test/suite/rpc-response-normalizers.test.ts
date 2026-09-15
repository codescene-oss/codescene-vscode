import * as assert from 'assert';
import { queueResponse } from '../../devtools-api/rpc-response-normalizers';

suite('queueResponse', () => {
  const cases: Array<{ name: string; input: Record<string, unknown>; expected: { count: number; files: string[] } | undefined }> = [
    { name: 'returns undefined when queue is omitted', input: { path: 'a.js' }, expected: undefined },
    { name: 'returns undefined when queue is null', input: { queue: null }, expected: undefined },
    {
      name: 'reads camelCase count and files',
      input: { queue: { count: 3, files: ['b.js', 'c.js'] } },
      expected: { count: 3, files: ['b.js', 'c.js'] },
    },
    {
      name: 'defaults missing files to an empty list',
      input: { queue: { count: 0 } },
      expected: { count: 0, files: [] },
    },
    {
      name: 'defaults missing count to 0',
      input: { queue: { files: ['a.js'] } },
      expected: { count: 0, files: ['a.js'] },
    },
  ];

  for (const { name, input, expected } of cases) {
    test(name, () => {
      assert.deepStrictEqual(queueResponse(input), expected);
    });
  }
});
