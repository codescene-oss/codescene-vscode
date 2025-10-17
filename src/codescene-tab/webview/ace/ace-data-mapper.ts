import { TextDocument } from 'vscode';
import { AceContextViewProps, FileMetaType } from '../../../centralized-webview-framework/types';
import { Confidence, Reason, RefactorResponse } from '../../../devtools-api/refactor-models';
import { RefactoringRequest } from '../../../refactoring/request';
import { Reason as CwfReason } from '../../../centralized-webview-framework/types/ace';
import { devmode } from '../../../centralized-webview-framework/cwf-html-utils';

interface CwfAceData {
  request: RefactoringRequest;
  result?: RefactorResponse;
  isStale: boolean;
  error: boolean;
  loading: boolean;
}

export function getAceData(data: CwfAceData): AceContextViewProps {
  const { request, result, isStale, error, loading } = data;

  return {
    view: 'ace',
    ideType: 'VSCode',
    devmode: devmode,
    data: {
      fileData: getFileData(request, request.document),
      aceResultData: result
        ? {
            code: result?.code,
            metadata: { 'cached?': result?.metadata['cached?'] },
            'trace-id': result?.['trace-id'],
            confidence: getConfidence(result.confidence),
            'credits-info': getCreditsInfo(result),
            reasons: getReasons(result.reasons),
            'refactoring-properties': {
              'added-code-smells': result['refactoring-properties']['added-code-smells'],
              'removed-code-smells': result['refactoring-properties']['removed-code-smells'],
            },
          }
        : undefined,
      isStale,
      loading,
      error,
    },
  };
}

function getConfidence(confidence: Confidence) {
  return {
    title: confidence.title,
    'review-header': confidence['review-header'] ?? '',
    level: confidence.level,
    'recommended-action': {
      details: confidence['recommended-action'].details,
      description: confidence['recommended-action'].description,
    },
  };
}

function getCreditsInfo(result: RefactorResponse) {
  return {
    used: result['credits-info']?.used ?? 0,
    limit: result['credits-info']?.limit ?? 0,
    reset: result['credits-info']?.reset,
  };
}

function getReasons(reasons: Reason[] = []): CwfReason[] {
  return reasons.map((reason) => ({
    summary: reason.summary,
    details:
      reason.details?.map((detail) => ({
        lines: detail.lines,
        columns: detail.columns,
        message: detail.message,
      })) ?? [],
  }));
}

export function getFileData(request: RefactoringRequest, document: TextDocument): FileMetaType {
  const fileData: FileMetaType = {
    fileName: document.fileName,
    fn: request.fnToRefactor.name
      ? {
          name: request.fnToRefactor.name,
          range: request.fnToRefactor.range
            ? {
                startLine: request.fnToRefactor.range['start-line'],
                startColumn: request.fnToRefactor.range['start-column'],
                endLine: request.fnToRefactor.range['end-line'],
                endColumn: request.fnToRefactor.range['end-column'],
              }
            : undefined,
        }
      : undefined,
  };
  return fileData;
}
