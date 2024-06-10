import * as vscode from 'vscode';

// Finds the column range of the function name in the line of code that it appears in
export function getFunctionNameRange(line: string, functionName: string): [number, number] {
  const functionNameIndex = line.indexOf(functionName);
  if (functionNameIndex === -1) {
    const periodIndex = functionName.indexOf('.');
    if (periodIndex !== -1) {
      // Try again with the function name without the class name
      const functionNameWithoutClass = functionName.slice(periodIndex + 1);
      return getFunctionNameRange(line, functionNameWithoutClass);
    }
    return [0, 0];
  }
  return [functionNameIndex, functionNameIndex + functionName.length];
}

interface FunctionCoordinate {
  name: string;
  startLine: number;
  endLine: number;
}

export function fnCoordinateToRange(
  category: string,
  functionCoordinate: FunctionCoordinate,
  document: vscode.TextDocument
): vscode.Range {
  const startLine = functionCoordinate.startLine - 1;
  const startLineText = document.lineAt(startLine).text;

  // Complex conditional does NOT occur on the same line as the function name,
  // it occurs on the line(s) of the conditional itself.
  if (category === 'Complex Conditional') {
    const startColumn = startLineText.search(/\S|$/);
    const endColumn = 0;
    return new vscode.Range(startLine, startColumn > 0 ? startColumn : 0, functionCoordinate.endLine, endColumn);
  }

  // Other issues occur on the same line as the function name and we use the
  // function name to find the range
  const [startColumn, endColumn] = getFunctionNameRange(startLineText, functionCoordinate.name);
  return new vscode.Range(startLine, startColumn, startLine, endColumn);
}
