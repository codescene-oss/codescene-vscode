import { Diagnostic } from 'vscode';
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
