import { exec } from 'child_process';
import { dirname } from 'path';
import * as vscode from 'vscode';
import { execWithInput, getFileExtension, getFunctionNameRange, isDefined } from './utils';

// Cache the results of the 'cs check' command so that we don't have to run it again
// We store the promise so that even if a call hasn't completed yet, we can still return the same promise.
// That way there is only one 'cs check' command running at a time for the same document version.
interface CheckCacheItem {
  documentVersion: number;
  diagnostics: Promise<vscode.Diagnostic[]>;
}

// This details the structure of the JSON output from the 'cs review' command
interface ReviewResult {
  score: number;
  review: ReviewIssue[];
}

interface ReviewIssue {
  category: string;
  code: string;
  description: string;
  functions?: IssueDetails[];
}

interface IssueDetails {
  details: string;
  title: string;
  'start-line': number;
}

const checkCache = new Map<string, CheckCacheItem>();

function reviewIssueToDiagnostics(reviewIssue: ReviewIssue, document: vscode.TextDocument) {
  if (!reviewIssue.functions) {
    return [produceDiagnostic('info', new vscode.Range(0, 0, 0, 0), reviewIssue.category, reviewIssue.code)];
  }

  return reviewIssue.functions.map((func: IssueDetails) => {
    const lineNumber = func['start-line'] - 1;
    const [startColumn, endColumn] = getFunctionNameRange(document.lineAt(lineNumber).text, func.title);
    const range = new vscode.Range(lineNumber, startColumn, lineNumber, endColumn);

    let description;
    if (func.details) {
      description = `${reviewIssue.category} (${func.details})`;
    } else {
      description = reviewIssue.category;
    }

    return produceDiagnostic('warning', range, description, reviewIssue.code);
  });
}

export function review(cliPath: string, document: vscode.TextDocument, skipCache = false) {
  console.log('CodeScene: running "cs review" on ' + document.fileName);

  if (!skipCache) {
    const cachedResults = checkCache.get(document.fileName);
    if (cachedResults && cachedResults.documentVersion === document.version) {
      console.log('CodeScene: returning cached diagnostics for ' + document.fileName);
      return cachedResults.diagnostics;
    }
  }

  const fileExtension = getFileExtension(document.fileName);

  // Get the fsPath of the current document because we want to execute the 'cs review' command
  // in the same directory as the current document (to pick up on any .codescene/code-health-config.json file)
  const documentPath = document.uri.fsPath;
  const documentDirectory = dirname(documentPath);

  const output = execWithInput(`"${cliPath}" review -f ${fileExtension}`, documentDirectory, document.getText());

  const diagnosticsPromise = output.then((output) => {
    const data = JSON.parse(output) as ReviewResult;
    const scoreDiagnostic = produceDiagnostic('info', new vscode.Range(0, 0, 0, 0), `Code health score: ${data.score}`);
    const diagnostics = data.review.flatMap((reviewIssue) => reviewIssueToDiagnostics(reviewIssue, document));
    return [scoreDiagnostic, ...diagnostics];
  });

  // Store result in cache.
  checkCache.set(document.fileName, { documentVersion: document.version, diagnostics: diagnosticsPromise });

  return diagnosticsPromise;
}

function produceDiagnostic(severity: string, range: vscode.Range, message: string, issueCode?: string) {
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

  // We don't want to add diagnostics for the "file level" issues, because it looks a bit ugly.
  // Instead, they are only shown as code lenses.
  if (issueCode) {
    const args = [vscode.Uri.parse(`csdoc:${issueCode}.md`)];
    const openDocCommandUri = vscode.Uri.parse(
      `command:markdown.showPreviewToSide?${encodeURIComponent(JSON.stringify(args))}`
    );
    diagnostic.code = {
      value: issueCode,
      target: openDocCommandUri,
    };
  }

  return diagnostic;
}

/**
 * Excecutes the command for creating a code health rules template, and returns the result as a string.
 */
export function codeHealthRulesJson(cliPath: string) {
  const completedPromise = new Promise<string>((resolve, reject) => {
    console.log('CodeScene: running "cs help code-health-rules-template"');
    exec(`"${cliPath}" help code-health-rules-template`, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });

  return completedPromise;
}
