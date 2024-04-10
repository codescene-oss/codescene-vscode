import { window } from 'vscode';
import Reviewer from "./review/reviewer";

/**
 * Function to show verbose response for review command in current file. This will help users understand if the rules file is configured properly. 
 * @param cliPath path to the CodeScene binary
 * @returns void
 */
export async function showVerboseReview(cliPath: string) {
    const editor = window.activeTextEditor;
    if (editor && editor.document) {
        const uri = editor.document.uri;
        const filePath = uri.fsPath;
        const res = await Reviewer.instance.review(editor.document, {skipCache: true, verbose: true});
        void window.showInformationMessage("Check log output for result");
    } else {
        void window.showErrorMessage('No file is currently selected.');
    }
  }