import { exec } from 'child_process';
import { dirname } from 'path';
import * as vscode from 'vscode';
import { getFileExtension, getFunctionNameRange } from './utils';

// Cache the results of the 'cs check' command so that we don't have to run it again
// We store the promise so that even if a call hasn't completed yet, we can still return the same promise.
// That way there is only one 'cs check' command running at a time for the same document version.
const checkCache = {
  documentVersion: -1,
  diagnostics: Promise.resolve([] as vscode.Diagnostic[]),
};

export function check(document: vscode.TextDocument, skipCache = false) {
  if (!skipCache && document.version === checkCache.documentVersion) {
    console.log('CodeScene: returning cached diagnostics for ' + document.fileName);
    return checkCache.diagnostics;
  }

  const completedPromise = new Promise<vscode.Diagnostic[]>((resolve, reject) => {
    console.log('CodeScene: running "cs check" on ' + document.fileName);

    const fileExtension = getFileExtension(document.fileName);

    // Get the fsPath of the current document because we want to execute the 'cs check' command
    // in the same directory as the current document (to pick up on any .codescene/code-health-config.json file)
    const documentPath = document.uri.fsPath;
    const documentDirectory = dirname(documentPath);

    // Execute the CodeScene 'check' command and parse out the results,
    // and convert them to VS Code diagnostics
    const childProcess = exec(`cs check -f ${fileExtension}`, { cwd: documentDirectory }, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
        return;
      }

      const diagnostics: vscode.Diagnostic[] = [];

      const lines = stdout.split('\n');
      for (const line of lines) {
        // Each line contains severity, filename, line, function name and message
        // Example: info: src/extension.ts:22:bad-fn Complex function (cc: 10)
        const match = line.match(/(\w+): (.+):(\d+):([^\s]+): (.+)/);

        if (match) {
          const [_, severity, _filename, line, functionName, message] = match;
          const lineNumber = Number(line) - 1;

          const [startColumn, endColumn] = getFunctionNameRange(document.lineAt(lineNumber).text, functionName);

          // Produce the diagnostic
          const range = new vscode.Range(lineNumber, startColumn, lineNumber, endColumn);
          const diagnostic = produceDiagnostic(severity, range, message);

          diagnostics.push(diagnostic);
        }
      }

      resolve(diagnostics);
    });

    if (childProcess.stdin) {
      childProcess.stdin.write(document.getText());
      childProcess.stdin.end();
    } else {
      reject('Error: cannot write to stdin of the CodeScene process');
    }
  });

  // Store result in cache.
  checkCache.documentVersion = document.version;
  checkCache.diagnostics = completedPromise;

  return completedPromise;
}

function produceDiagnostic(severity: string, range: vscode.Range, message: string) {
  let diagnosticSeverity: vscode.DiagnosticSeverity;
  switch (severity) {
    case 'info':
      diagnosticSeverity = vscode.DiagnosticSeverity.Information;
      break;
    case 'warning':
      diagnosticSeverity = vscode.DiagnosticSeverity.Warning;
      break;
    case 'error':
      diagnosticSeverity = vscode.DiagnosticSeverity.Error;
      break;
    default:
      diagnosticSeverity = vscode.DiagnosticSeverity.Error;
  }

  const diagnostic = new vscode.Diagnostic(range, message, diagnosticSeverity);
  diagnostic.source = 'CodeScene';
  return diagnostic;
}
