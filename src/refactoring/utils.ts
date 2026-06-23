import vscode, {
  Position,
  Range,
  Selection,
  TextDocument,
  TextEditorRevealType,
  ViewColumn,
  window,
} from 'vscode';

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
