import { exec } from 'child_process';
import { dirname } from 'path';
import * as vscode from 'vscode';
import { execWithInput, getFileExtension, getFunctionNameRange, execAndLog } from './utils';

// Cache the results of the 'cs review' command so that we don't have to run it again
// We store the promise so that even if a call hasn't completed yet, we can still return the same promise.
// That way there is only one 'cs review' command running at a time for the same document version.
interface ReviewCacheItem {
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

const reviewCache = new Map<string, ReviewCacheItem>();

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
    const cachedResults = reviewCache.get(document.fileName);
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
    const diagnostics = data.review.flatMap((reviewIssue) => reviewIssueToDiagnostics(reviewIssue, document));
    // If the score is zero, there's no scorable code in the file, so don't create a diagnostic for it.
    if (data.score > 0) {
      const scoreDiagnostic = produceDiagnostic('info', new vscode.Range(0, 0, 0, 0), `Code health score: ${data.score}`);
      return [scoreDiagnostic, ...diagnostics];
    } else {
      return diagnostics;
    }
  });

  // Store result in cache.
  reviewCache.set(document.fileName, { documentVersion: document.version, diagnostics: diagnosticsPromise });

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
  console.log('CodeScene: running "cs help code-health-rules-template"');
  const command: string = `"${cliPath}" help code-health-rules-template`;
  return execAndLog(command, '"cs help code-health-rules-template"');
}

/**
 * Executes the command for signing a payload, and returns the resulting signature as a string.
 */
export async function sign(cliPath: string, payload: string) {
  console.log('CodeScene: running "cs sign" on ' + payload);
  const command: string = `"${cliPath}" sign`;
  return await execWithInput(command, "", payload);
}