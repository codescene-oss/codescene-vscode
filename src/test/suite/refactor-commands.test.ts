import * as assert from 'assert';
import { Range } from 'vscode';
import { EnclosingFn } from '../../codescene-interop';
import { rangeAndLocFromEnclosingFn } from '../../refactoring/commands';

const enclosingFn1: EnclosingFn = {
  name: 'anon',
  'start-line': 1,
  'end-line': 1,
  body: 'const a = () => {};',
  'function-type': 'FatArrrowFn',
  'start-column': 0,
  'end-column': 19,
};

const enclosingFn2: EnclosingFn = {
  name: 'notSoGoodXX',
  'start-line': 48,
  'end-line': 101,
  body: 'function notSoGoodXX(\n  intersects,\n  endRel,\n  startRel,\n  endX,\n  endY,\n  minX,\n  minY,\n  maxX,\n  maxY,\n  slope\n) {\n  if (\n    !intersects &&\n    !!(endRel & Relationship.RIGHT) &&\n    !(startRel & Relationship.RIGHT)\n  ) {\n    // potentially intersects right\n    y = endY - (endX - maxX) * slope;\n    intersects = y >= minY && y <= maxY;\n  }\n\n  switch (param.type) {\n    case "Identifier":\n      nodes.push(param);\n      break;\n\n    case "ObjectPattern":\n      for (const prop of param.properties) {\n        if (prop.type === "RestElement") {\n          extract_identifiers(prop.argument, nodes);\n        } else {\n          extract_identifiers(prop.value, nodes);\n        }\n      }\n\n      break;\n\n    case "ArrayPattern":\n      for (const element of param.elements) {\n        if (element) extract_identifiers(element, nodes);\n      }\n\n      break;\n\n    case "RestElement":\n      extract_identifiers(param.argument, nodes);\n      break;\n\n    case "AssignmentPattern":\n      extract_identifiers(param.left, nodes);\n      break;\n  }\n}',
  'function-type': 'StandaloneFn',
  'start-column': 0,
  'end-column': 1,
};

suite('Refactor commands Test Suite', () => {
  test('Handle output from findEnclosingFunction call', async () => {
    const { range, loc } = rangeAndLocFromEnclosingFn(enclosingFn1);
    assert.ok(range.isEqual(new Range(0, 0, 0, 19)));
    assert.equal(loc, 1);
  });

  test('Handle output from findEnclosingFunction call', async () => {
    const { range, loc } = rangeAndLocFromEnclosingFn(enclosingFn2);
    assert.ok(range.isEqual(new Range(47, 0, 100, 1)));
    assert.equal(loc, 54);
  });
});
