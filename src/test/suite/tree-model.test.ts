import assert from 'assert';
import { sortFn } from '../../code-health-monitor/tree-model';

suite('Code Health Monitor tree-model Test Suite', () => {
  test('Test sorting of DeltaFunctionItems', async () => {
    const list: any[] = [
      { fnName: 'b', isRefactoringSupported: true, range: { start: { line: 2 } } },
      { fnName: 'e', isRefactoringSupported: false, range: undefined },
      { fnName: 'a', isRefactoringSupported: true, range: { start: { line: 1 } } },
      { fnName: 'd', isRefactoringSupported: false, range: { start: { line: 2 } } },
      { fnName: 'c', isRefactoringSupported: false, range: { start: { line: 1 } } },
    ];
    list.sort(sortFn);
    const order = list.map((o) => o.fnName).join('');
    assert.equal(order, 'abcde');
  });
});
