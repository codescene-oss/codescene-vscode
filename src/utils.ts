export function getFileExtension(filename: string) {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

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

export function getFileNameWithoutExtension(filename: string) {
  const index = filename.lastIndexOf('.');
  return filename.slice(0, index > 0 ? index : filename.length);
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function foo() {
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
  const a = 1;
}
