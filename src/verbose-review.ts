import { window } from 'vscode';
import Reviewer from "./review/reviewer";

/**
 * Function to show verbose response for review command in current file. This will help users understand if the rules file is configured properly. 
 * @returns void
 */
export function showVerboseReview() {
    const editor = window.activeTextEditor;
    if (editor && editor.document) {
        void Reviewer.instance.review(editor.document, {skipCache: true, verbose: true});
    } else {
        void window.showErrorMessage('No file is currently selected.');
    }
  }