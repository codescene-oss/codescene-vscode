export function getFileExtension(filename: string) {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2);
}

// Finds the column range of the function name in the line of code that it appears in
export function getFunctionNameRange(line: string, functionName: string) {
  const functionNameIndex = line.indexOf(functionName);
  return [functionNameIndex, functionNameIndex + functionName.length];
}
