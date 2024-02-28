import { ReasonsWithDetails } from '../cs-rest-api';
import { isDefined } from '../utils';

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
    codeLines.splice(
      detail.lines[0] + commentsAdded,
      0,
      `${singleLineCommentSeparator(languageId)} ⚠️ ${detail.message}`
    );
    commentsAdded++;
  });
  return codeLines.join('\n');
}
