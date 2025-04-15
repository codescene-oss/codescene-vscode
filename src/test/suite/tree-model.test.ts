import assert from 'assert';
import { sortFnInfo, sortIssues } from '../../code-health-monitor/tree-model';

suite('Code Health Monitor tree-model Test Suite', () => {
  test('Test sorting of DeltaFunctionItems', async () => {
    const list: any[] = [
      { fnName: 'b', range: { start: { line: 2 } }, children: [] },
      { fnName: 'e', range: undefined, children: [] },
      { fnName: 'a', range: { start: { line: 1 } }, children: [] },
      { fnName: 'd', range: { start: { line: 2 } }, children: [] },
      { fnName: 'c', range: { start: { line: 1 } }, children: [] },
      {
        fnName: 'aDegradedOnly',
        range: { start: { line: 1 } },
        children: [{ changeDetail: { 'change-type': 'degraded' } }],
      },
      {
        fnName: 'aMixed1',
        range: { start: { line: 1 } },
        children: [{ changeDetail: { 'change-type': 'degraded' } }, { changeDetail: { 'change-type': 'improved' } }],
      },
      {
        fnName: 'aMixed2',
        range: { start: { line: 1 } },
        children: [{ changeDetail: { 'change-type': 'improved' } }, { changeDetail: { 'change-type': 'fixed' } }],
      },
      {
        fnName: 'aFixed',
        range: { start: { line: 1 } },
        children: [{ changeDetail: { 'change-type': 'fixed' } }],
      },
    ];
    list.sort(sortFnInfo);
    const order = list.map((o) => o.fnName).join(',');
    assert.equal(order, 'a,c,b,d,aDegradedOnly,aMixed1,aMixed2,aFixed,e');
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
