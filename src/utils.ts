export function getFileExtension(filename: string) {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

// Finds the column range of the function name in the line of code that it appears in
export function getFunctionNameRange(line: string, functionName: string) {
  const functionNameIndex = line.indexOf(functionName);
  if (functionNameIndex === -1) {
    return [0, 0];
  }
  return [functionNameIndex, functionNameIndex + functionName.length];
}

export function getFileNameWithoutExtension(filename: string) {
  const index = filename.lastIndexOf('.');
  return filename.slice(0, index > 0 ? index : filename.length);
}
