import * as vscode from 'vscode';
import { DeltaFunctionInfo } from '../code-health-monitor/delta-function-info';
import { DeltaIssue } from '../code-health-monitor/delta-issue';
import { FnToRefactor } from '../devtools-api/refactor-models';
import Telemetry from '../telemetry';
import { CodeSceneCWFDocsTabPanel } from '../codescene-tab/webview/documentation/cwf-webview-docs-panel';
import { CodeSmell, Range, Review } from '../devtools-api/review-model';
import { findFunctionForCodeSmell } from '../review/utils';
import Reviewer from '../review/reviewer';

export function register(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'codescene.openInteractiveDocsPanel',
      (params: InteractiveDocsParams, source: string) => {
        Telemetry.logUsage('openInteractiveDocsPanel', { source, category: params?.issueInfo?.category });
        CodeSceneCWFDocsTabPanel.show(params);
      }
    ),
    // A query param friendly version of openInteractiveDocsPanel
    vscode.commands.registerCommand('codescene.openInteractiveDocsFromDiagnosticTarget', async (queryParams) => {
      const { category, lineNo, charNo, documentUri, codeSmell } = queryParams;
      Telemetry.logUsage('openInteractiveDocsPanel', { source: 'diagnostic-item', category });
      const document = await findOrOpenDocument(documentUri);
      
      // Try to get review result to extract function range info
      let functionRange: FunctionRange | undefined;
      const cacheItem = Reviewer.instance.reviewCache.get(document);
      if (cacheItem) {
        const reviewResult = await cacheItem.review.reviewResult;
        if (reviewResult && codeSmell) {
          const functionInfo = findFunctionForCodeSmell(reviewResult, codeSmell);
          if (functionInfo) {
            functionRange = {
              function: functionInfo.function,
              range: functionInfo.range,
            };
          }
        }
      }
      
      const params: InteractiveDocsParams = {
        issueInfo: {
          category,
          position: new vscode.Position(lineNo, charNo),
          range: getVsCodeRangeByCodeSmell(codeSmell),
          fnName: functionRange?.function,
        },
        document,
        codeSmell,
        functionRange,
      };
      CodeSceneCWFDocsTabPanel.show(params);
    }),
    vscode.commands.registerCommand('codescene.openCodeHealthDocs', (args) => {
      Telemetry.logUsage('openCodeHealthDocs');

      const params: InteractiveDocsParams = {
        issueInfo: { category: 'docs_general_code_health', position: new vscode.Position(0, 0) },
        document: args,
      };
      CodeSceneCWFDocsTabPanel.show(params);
    })
  );
}

export async function findOrOpenDocument(uri: vscode.Uri) {
  let document = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
  if (!document) {
    document = await vscode.workspace.openTextDocument(uri);
  }
  return document;
}

export interface IssueInfo {
  category: string;
  position?: vscode.Position;
  fnName?: string;
  range?: vscode.Range;
}

export interface FunctionRange {
  function: string;
  range: Range;
}

export interface InteractiveDocsParams {
  issueInfo: IssueInfo;
  document?: vscode.TextDocument;
  fnToRefactor?: FnToRefactor;
  codeSmell?: CodeSmell;
  functionRange?: FunctionRange;
}

export function isInteractiveDocsParams(obj: unknown): obj is InteractiveDocsParams {
  if (!obj) return false;
  if (typeof obj === 'object') {
    Object.hasOwnProperty.call(obj, 'issueInfo');
    return obj.hasOwnProperty('issueInfo') && obj.hasOwnProperty('document');
  }
  return false;
}

export function issueToDocsParams(issue: DeltaIssue, fnInfo?: DeltaFunctionInfo) {
  const params = toDocsParams(issue.changeDetail.category, issue.parentDocument, issue.position);
  params.issueInfo.fnName = fnInfo?.fnName;
  params.fnToRefactor = fnInfo?.fnToRefactor;
  return params;
}

export interface ToDocsParamsRangedOptions {
  fnToRefactor?: FnToRefactor;
  reviewResult?: Review;
}

export function toDocsParamsRanged(
  category: string,
  document: vscode.TextDocument,
  codeSmell: CodeSmell,
  options?: ToDocsParamsRangedOptions
): InteractiveDocsParams {
  const { fnToRefactor, reviewResult } = options || {};
  let functionRange: FunctionRange | undefined;
  
  // If we don't have fnToRefactor but have a review result, try to find the function range from function-level-code-smells
  if (!fnToRefactor && reviewResult) {
    const functionInfo = findFunctionForCodeSmell(reviewResult, codeSmell);
    if (functionInfo) {
      functionRange = {
        function: functionInfo.function,
        range: functionInfo.range,
      };
    }
  }

  return {
    issueInfo: {
      category,
      position: new vscode.Position(
        codeSmell['highlight-range']['start-line'] - 1, // vscode.Position is 0-based, while code smell range is 1-based.
        codeSmell['highlight-range']['start-column'] - 1
      ),
      range: getVsCodeRangeByCodeSmell(codeSmell),
      fnName: fnToRefactor?.name ?? functionRange?.function ?? '',
    },
    document,
    fnToRefactor,
    codeSmell,
    functionRange,
  };
}

export function getVsCodeRangeByCodeSmell(codeSmell: CodeSmell) {
  return new vscode.Range(
    new vscode.Position(codeSmell['highlight-range']['start-line'], codeSmell['highlight-range']['start-column']),
    new vscode.Position(codeSmell['highlight-range']['end-line'], codeSmell['highlight-range']['end-column'])
  );
}

export function toDocsParams(
  category: string,
  document: vscode.TextDocument,
  position?: vscode.Position,
  fnToRefactor?: FnToRefactor
): InteractiveDocsParams {
  return { issueInfo: { category, position, fnName: fnToRefactor?.name }, document, fnToRefactor };
}

export function categoryToDocsCode(issueCategory: string) {
  return issueCategory.replace(/ /g, '-').replace(/,/g, '').toLowerCase();
}
