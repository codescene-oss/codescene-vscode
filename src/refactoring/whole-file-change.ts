import { TextDocument } from 'vscode';
import { FnToRefactor } from '../devtools-api/refactor-models';

function toLf(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

export function functionFromWholeFile(
  document: TextDocument,
  fnToRefactor: FnToRefactor,
  wholeFileContent: string
): string | undefined {
  const original = document.getText();
  const prefix = toLf(original.slice(0, document.offsetAt(fnToRefactor.vscodeRange.start)));
  const suffix = toLf(original.slice(document.offsetAt(fnToRefactor.vscodeRange.end)));
  const content = toLf(wholeFileContent);

  const fitsAroundFunction =
    content.length >= prefix.length + suffix.length && content.startsWith(prefix) && content.endsWith(suffix);
  return fitsAroundFunction ? content.slice(prefix.length, content.length - suffix.length) : undefined;
}
