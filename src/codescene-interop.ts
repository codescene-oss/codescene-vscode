import { dirname } from 'path';
import * as vscode from 'vscode';
import { getFileExtension, getFunctionNameRange } from './utils';
import { LimitingExecutor, SimpleExecutor } from './executor';

// Cache the results of the 'cs review' command so that we don't have to run it again
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

const limitingExecutioner = new LimitingExecutor();

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

export async function review(cliPath: string, document: vscode.TextDocument, skipCache = false) {
  // If we have a cached result for this document, return it.
  if (!skipCache) {
    const cachedResults = reviewCache.get(document.fileName);
    if (cachedResults && cachedResults.documentVersion === document.version) {
      console.log('CodeScene: returning cached diagnostics for ' + document.fileName);
      return cachedResults.diagnostics;
    }
  }

  const fileExtension = getFileExtension(document.fileName);

  // Get the fsPath of the current document because we want to execute the
  // 'cs review' command in the same directory as the current document
  // (i.e. inside the repo to pick up on any .codescene/code-health-config.json file)
  const documentPath = document.uri.fsPath;
  const documentDirectory = dirname(documentPath);

  const result = limitingExecutioner.execute(
    { command: cliPath, args: ['review', '-f', fileExtension], taskId: documentPath },
    { cwd: documentDirectory },
    document.getText()
  );

  const diagnostics = result.then(({ stdout, stderr }) => {
    const data = JSON.parse(stdout) as ReviewResult;
    let diagnostics = data.review.flatMap((reviewIssue) => reviewIssueToDiagnostics(reviewIssue, document));

    if (data.score > 0) {
      const scoreDiagnostic = produceDiagnostic(
        'info',
        new vscode.Range(0, 0, 0, 0),
        `Code health score: ${data.score}`
      );
      return [scoreDiagnostic, ...diagnostics];
    } else {
      return diagnostics;
    }
  });

  // Store result in cache.
  reviewCache.set(document.fileName, { documentVersion: document.version, diagnostics });

  return diagnostics;
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
 * Executes the command for creating a code health rules template, and returns the result as a string.
 */
export function codeHealthRulesJson(cliPath: string) {
  return new SimpleExecutor().execute({ command: cliPath, args: ['help', 'code-health-rules-template'] });
}

/**
 * Executes the command for signing a payload, and returns the resulting signature as a string.
 */
export async function sign(cliPath: string, payload: string) {
  return new SimpleExecutor().execute({ command: cliPath, args: ['sign'] }, {}, payload);
}
