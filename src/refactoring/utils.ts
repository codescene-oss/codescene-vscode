import vscode, {
  Position,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  Uri,
  ViewColumn,
  window,
} from 'vscode';
import { RefactorResponse } from '../devtools-api/refactor-models';
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

export function decorateCode(refactorResponse: RefactorResponse, languageId: string) {
  const { code, 'reasons-with-details': reasonsWithDetails } = refactorResponse;
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

/**
 * Finds the editor associated with a document.
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

// Use this scheme for the virtual documents when diffing the refactoring
export function createTmpDiffUriScheme() {
  const uriQueryContentProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return uri.query;
    }
  })();
  return vscode.workspace.registerTextDocumentContentProvider('tmp-diff', uriQueryContentProvider);
}

export type CodeWithLangId = {
  content: string;
  languageId: string;
};
/**
 * Create a virtual document used for tmp diffing in the editor.
 * The scheme is registered with a content provider in extension.ts
 */
export async function createTempDocument(name: string, code: CodeWithLangId) {
  const tmpUri = Uri.from({ scheme: 'tmp-diff', path: name, query: code.content });
  const tmpDoc = await vscode.workspace.openTextDocument(tmpUri);
  return vscode.languages.setTextDocumentLanguage(tmpDoc, code.languageId);
}

function rangeFromCode(position: Position, code: string) {
  const lines = code.split(/\r\n|\r|\n/);
  const lineDelta = lines.length - 1;
  const characterDelta = lines[lines.length - 1].length;
  return new Range(position, position.translate({ lineDelta, characterDelta }));
}

/**
 * Opens the document if not already opened, and selects the code at a position in the
 * editor containing the document
 */
export async function selectCode(document: vscode.TextDocument, code: string, position: vscode.Position) {
  const newRange = rangeFromCode(position, code);
  const editor =
    targetEditor(document) ||
    (await vscode.window.showTextDocument(document.uri, {
      preview: false,
      viewColumn: ViewColumn.One,
    }));
  editor.selection = new Selection(newRange.start, newRange.end);
  editor.revealRange(newRange, TextEditorRevealType.InCenterIfOutsideViewport);
}
