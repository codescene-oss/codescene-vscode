import assert from 'assert';
import { sortFnInfo, sortIssues } from '../../code-health-monitor/sort-fn-info';

suite('Code Health Monitor tree-model Test Suite', () => {
  test('Test sorting of DeltaFunctionItems', async () => {
    const list: any[] = [
      { fnName: 'b', isRefactoringSupported: true, range: { start: { line: 2 } }, children: [] },
      { fnName: 'e', isRefactoringSupported: false, range: undefined, children: [] },
      { fnName: 'a', isRefactoringSupported: true, range: { start: { line: 1 } }, children: [] },
      { fnName: 'd', isRefactoringSupported: false, range: { start: { line: 2 } }, children: [] },
      { fnName: 'c', isRefactoringSupported: false, range: { start: { line: 1 } }, children: [] },
      {
        fnName: 'aDegradedOnly',
        isRefactoringSupported: true,
        range: { start: { line: 1 } },
        children: [{ changeDetail: { 'change-type': 'degraded' } }],
      },
      {
        fnName: 'aMixed1',
        isRefactoringSupported: true,
        range: { start: { line: 1 } },
        children: [{ changeDetail: { 'change-type': 'degraded' } }, { changeDetail: { 'change-type': 'improved' } }],
      },
      {
        fnName: 'aMixed2',
        isRefactoringSupported: true,
        range: { start: { line: 1 } },
        children: [{ changeDetail: { 'change-type': 'improved' } }, { changeDetail: { 'change-type': 'fixed' } }],
      },
      {
        fnName: 'aFixed',
        isRefactoringSupported: true,
        range: { start: { line: 1 } },
        children: [{ changeDetail: { 'change-type': 'fixed' } }],
      },
    ];
    list.sort(sortFnInfo);
    const order = list.map((o) => o.fnName).join(',');
    assert.equal(order, 'a,b,aDegradedOnly,aMixed1,aMixed2,aFixed,c,d,e');
  });

  test('Test sorting of DeltaIssues', async () => {
    const list: any[] = [
      { id: 'd', changeDetail: { 'change-type': 'fixed' } },
      { id: 'a', changeDetail: { 'change-type': 'introduced' } },
      { id: 'b', changeDetail: { 'change-type': 'degraded' } },
      { id: 'c', changeDetail: { 'change-type': 'improved' } },
    ];
    list.sort(sortIssues);
    const order = list.map((o) => o.id).join('');
    assert.equal(order, 'abcd');
  });
});
