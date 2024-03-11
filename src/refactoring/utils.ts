import { Diagnostic, TextDocument, window } from 'vscode';
import { PreFlightResponse, ReasonsWithDetails } from '../cs-rest-api';
import { DiagnosticFilter, isDefined } from '../utils';

function singleLineCommentSeparator(languageId: string) {
  switch (languageId) {
    case 'javascript':
    case 'javascriptreact':
    case 'typescript':
    case 'typescriptreact':
      return '//';
    default:
      return '//';
  }
}

export function decorateCode(code: string, languageId: string, reasonsWithDetails: ReasonsWithDetails[]) {
  const allDetails = reasonsWithDetails.flatMap((reason) => reason.details).filter(isDefined);
  if (allDetails.length === 0) return code;

  const codeLines = code.split('\n');
  let commentsAdded = 0;
  allDetails.forEach((detail) => {
    const commentLines = detail.message.split('\n').map((msgLine, i) => {
      if (i === 0) return `${singleLineCommentSeparator(languageId)} ⚠️ ${msgLine}`;
      return `${singleLineCommentSeparator(languageId)} ${msgLine}`;
    });
    codeLines.splice(detail.lines[0] + commentsAdded, 0, ...commentLines);
    commentsAdded += commentLines.length;
  });
  return codeLines.join('\n');
}

export function createCodeSmellsFilter(refactorCapabilities: PreFlightResponse): DiagnosticFilter {
  return (d: Diagnostic) =>
    d.code instanceof Object && refactorCapabilities.supported['code-smells'].includes(d.code.value.toString());
}

/**
 * Finds the editor associated with the request document.
 *
 * Primarily this is the activeTextEditor, but that might be out of focus. If so, we will
 * target the first editor in the list of visibleTextEditors matching the request document.
 */
export function targetEditor(document: TextDocument) {
  if (window.activeTextEditor?.document === document) {
    return window.activeTextEditor;
  } else {
    for (const e of window.visibleTextEditors) {
      if (e.document === document) {
        return e;
      }
    }
  }
}
