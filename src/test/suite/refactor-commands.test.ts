import * as assert from 'assert';
import { Range, Diagnostic } from 'vscode';
import { EnclosingFn } from '../../codescene-interop';
import { codeSmellsFromDiagnostics, rangeFromEnclosingFn } from '../../refactoring/commands';

const enclosingFn1: EnclosingFn = {
  name: 'anon',
  'start-line': 1,
  'end-line': 1,
  body: 'const a = () => {};',
  'function-type': 'FatArrrowFn',
  'start-column': 0,
  'end-column': 19,
  'active-code-size': 1,
};

const enclosingFn2: EnclosingFn = {
  name: 'notSoGoodXX',
  'start-line': 48,
  'end-line': 101,
  body: 'function notSoGoodXX(\n  intersects,\n  endRel,\n  startRel,\n  endX,\n  endY,\n  minX,\n  minY,\n  maxX,\n  maxY,\n  slope\n) {\n  if (\n    !intersects &&\n    !!(endRel & Relationship.RIGHT) &&\n    !(startRel & Relationship.RIGHT)\n  ) {\n    // potentially intersects right\n    y = endY - (endX - maxX) * slope;\n    intersects = y >= minY && y <= maxY;\n  }\n\n  switch (param.type) {\n    case "Identifier":\n      nodes.push(param);\n      break;\n\n    case "ObjectPattern":\n      for (const prop of param.properties) {\n        if (prop.type === "RestElement") {\n          extract_identifiers(prop.argument, nodes);\n        } else {\n          extract_identifiers(prop.value, nodes);\n        }\n      }\n\n      break;\n\n    case "ArrayPattern":\n      for (const element of param.elements) {\n        if (element) extract_identifiers(element, nodes);\n      }\n\n      break;\n\n    case "RestElement":\n      extract_identifiers(param.argument, nodes);\n      break;\n\n    case "AssignmentPattern":\n      extract_identifiers(param.left, nodes);\n      break;\n  }\n}',
  'function-type': 'StandaloneFn',
  'start-column': 0,
  'end-column': 1,
  'active-code-size': 54,
};

suite('Refactor commands Test Suite', () => {
  test('Range and codeSmell lines calculations for simple function', async () => {
    const enclosingFunctionRange = rangeFromEnclosingFn(enclosingFn1);
    assert.ok(enclosingFunctionRange.isEqual(new Range(0, 0, 0, 19)));

    const complexMethod = new Diagnostic(new Range(0, 0, 0, 0), 'message');
    complexMethod.code = 'Complex Method';
    const codeSmell = codeSmellsFromDiagnostics([complexMethod], enclosingFunctionRange)[0];
    assert.equal(codeSmell.relativeStartLine, 0);
    assert.equal(codeSmell.relativeEndLine, 0);
  });

  test('Range and codeSmell lines calculations with more complex relative lines', async () => {
    const enclosingFunctionRange = rangeFromEnclosingFn(enclosingFn2);
    assert.ok(enclosingFunctionRange.isEqual(new Range(47, 0, 100, 1)));

    const complexMethod = new Diagnostic(new Range(47, 0, 47, 0), 'message');
    complexMethod.code = 'Complex Method';
    const complexConditional = new Diagnostic(new Range(55, 0, 60, 0), 'message');
    complexConditional.code = 'Complex Conditional';
    const codeSmells = codeSmellsFromDiagnostics([complexMethod, complexConditional], enclosingFunctionRange);
    assert.equal(codeSmells[0].relativeStartLine, 0);
    assert.equal(codeSmells[0].relativeEndLine, 53);

    assert.equal(codeSmells[1].relativeStartLine, 8);
    assert.equal(codeSmells[1].relativeEndLine, 40);
  });
});
