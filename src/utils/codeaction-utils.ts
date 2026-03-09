export function buildDisableAnnotation(category: string): string {
  return `@CodeScene(disable:"${category}")`;
}

export function getLineIndentation(lineText: string): string {
  const match = lineText.match(/^(\s*)/);
  return match ? match[1] : '';
}

export function buildInsertText(category: string, indentation: string): string {
  return indentation + buildDisableAnnotation(category) + '\n';
}
