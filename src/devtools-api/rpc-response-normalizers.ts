import { ChangeDetail, ChangeType, Delta, FunctionFinding } from './delta-model';
import { CheckRulesResponse } from './model';
import {
  Confidence,
  FnToRefactor,
  PreFlightResponse,
  RefactorResponse,
  RefactorSupport,
  RefactoringProperties,
} from './refactor-models';
import { CodeSmell, Function as ReviewFunction, Range, Review } from './review-model';

type WireObject = Record<string, any>;

function field<T>(value: WireObject, camelCase: string, kebabCase: string): T | undefined {
  return value[camelCase] ?? value[kebabCase];
}

function range(value: WireObject | undefined): Range | undefined {
  if (!value) return;
  return {
    'start-line': field<number>(value, 'startLine', 'start-line')!,
    'start-column': field<number>(value, 'startColumn', 'start-column')!,
    'end-line': field<number>(value, 'endLine', 'end-line')!,
    'end-column': field<number>(value, 'endColumn', 'end-column')!,
  };
}

function codeSmell(value: WireObject): CodeSmell {
  return {
    category: value.category,
    details: value.details ?? '',
    'highlight-range': range(field(value, 'highlightRange', 'highlight-range'))!,
  };
}

function reviewFunction(value: WireObject): ReviewFunction {
  return {
    function: value.function,
    range: range(value.range)!,
    'code-smells': (field<WireObject[]>(value, 'codeSmells', 'code-smells') ?? []).map(codeSmell),
  };
}

export function reviewResponse(value: WireObject): Review {
  return {
    'file-level-code-smells': (field<WireObject[]>(value, 'fileLevelCodeSmells', 'file-level-code-smells') ?? []).map(codeSmell),
    'function-level-code-smells': (field<WireObject[]>(value, 'functionLevelCodeSmells', 'function-level-code-smells') ?? []).map(reviewFunction),
    'raw-score': field<string>(value, 'rawScore', 'raw-score')!,
    ...(value.score === undefined ? {} : { score: value.score }),
    ...(field(value, 'codeHealthRulesError', 'code-health-rules-error') === undefined
      ? {}
      : { 'code-health-rules-error': field(value, 'codeHealthRulesError', 'code-health-rules-error') }),
    ...(field(value, 'gitBlobSha', 'git-blob-sha') === undefined
      ? {}
      : { 'git-blob-sha': field<string>(value, 'gitBlobSha', 'git-blob-sha') }),
  };
}

function changeDetail(value: WireObject): ChangeDetail {
  return {
    category: value.category,
    'change-type': field<ChangeType>(value, 'changeType', 'change-type')!,
    description: value.description,
    ...(value.line === undefined ? {} : { line: value.line }),
  };
}

function functionFinding(value: WireObject): FunctionFinding {
  return {
    function: {
      name: value.function.name,
      ...(range(value.function.range) ? { range: range(value.function.range) } : {}),
    },
    'change-details': (field<WireObject[]>(value, 'changeDetails', 'change-details') ?? []).map(changeDetail),
  };
}

export function deltaResponse(value: WireObject): Delta {
  return {
    'file-level-findings': (field<WireObject[]>(value, 'fileLevelFindings', 'file-level-findings') ?? []).map(changeDetail),
    'function-level-findings': (field<WireObject[]>(value, 'functionLevelFindings', 'function-level-findings') ?? []).map(functionFinding),
    'score-change': field<number>(value, 'scoreChange', 'score-change')!,
    ...(field(value, 'oldScore', 'old-score') === undefined ? {} : { 'old-score': field<number>(value, 'oldScore', 'old-score') }),
    ...(field(value, 'newScore', 'new-score') === undefined ? {} : { 'new-score': field<number>(value, 'newScore', 'new-score') }),
    ...(field(value, 'oldGitBlobSha', 'old-git-blob-sha') === undefined
      ? {}
      : { 'old-git-blob-sha': field<string>(value, 'oldGitBlobSha', 'old-git-blob-sha') }),
    ...(field(value, 'newGitBlobSha', 'new-git-blob-sha') === undefined
      ? {}
      : { 'new-git-blob-sha': field<string>(value, 'newGitBlobSha', 'new-git-blob-sha') }),
  };
}

function refactorSupport(value: WireObject): RefactorSupport {
  return {
    'max-input-loc': field<number>(value, 'maxInputLoc', 'max-input-loc')!,
    'code-smells': field<string[]>(value, 'codeSmells', 'code-smells') ?? [],
  };
}

export function preflightResponse(value: WireObject): PreFlightResponse {
  const languageSpecific = field<Record<string, WireObject>>(value, 'languageSpecific', 'language-specific');
  return {
    version: value.version,
    'file-types': field<string[]>(value, 'fileTypes', 'file-types') ?? [],
    'language-common': refactorSupport(field(value, 'languageCommon', 'language-common')!),
    ...(languageSpecific
      ? { 'language-specific': Object.fromEntries(Object.entries(languageSpecific).map(([language, support]) => [language, refactorSupport(support)])) }
      : {}),
  };
}

export function fnToRefactorResponse(value: WireObject): FnToRefactor {
  return {
    body: value.body,
    name: value.name,
    'file-type': field<string>(value, 'fileType', 'file-type')!,
    ...(field(value, 'functionType', 'function-type') === undefined
      ? {}
      : { 'function-type': field<string>(value, 'functionType', 'function-type') }),
    ...(field(value, 'nippyB64', 'nippy-b64') === undefined && value['nippy-b-64'] === undefined
      ? {}
      : { 'nippy-b64': field<string>(value, 'nippyB64', 'nippy-b64') ?? value['nippy-b-64'] }),
    range: range(value.range)!,
    'refactoring-targets': field(value, 'refactoringTargets', 'refactoring-targets') ?? [],
    vscodeRange: undefined!,
  };
}

function confidence(value: WireObject): Confidence {
  return {
    level: value.level,
    title: value.title,
    'recommended-action': field(value, 'recommendedAction', 'recommended-action')!,
    ...(field(value, 'reviewHeader', 'review-header') === undefined
      ? {}
      : { 'review-header': field<string>(value, 'reviewHeader', 'review-header') }),
  };
}

function refactoringProperties(value: WireObject): RefactoringProperties {
  return {
    'added-code-smells': field(value, 'addedCodeSmells', 'added-code-smells') ?? [],
    'removed-code-smells': field(value, 'removedCodeSmells', 'removed-code-smells') ?? [],
  };
}

export function refactorResponse(value: WireObject): RefactorResponse {
  return {
    code: value.code,
    confidence: confidence(value.confidence),
    ...(value.declarations === undefined ? {} : { declarations: value.declarations }),
    metadata: value.metadata,
    reasons: value.reasons ?? [],
    'refactoring-properties': refactoringProperties(field(value, 'refactoringProperties', 'refactoring-properties')!),
    'trace-id': field<string>(value, 'traceId', 'trace-id')!,
    ...(field(value, 'creditsInfo', 'credits-info') === undefined
      ? {}
      : { 'credits-info': field(value, 'creditsInfo', 'credits-info') }),
  };
}

export function checkRulesResponse(value: WireObject): CheckRulesResponse {
  return {
    result: value.result,
    failed: value.failed ?? false,
    'parsing-errors': field(value, 'parsingErrors', 'parsing-errors') ?? [],
  };
}

export function deviceIdResponse(value: WireObject): { 'device-id': string } {
  return { 'device-id': field<string>(value, 'deviceId', 'device-id')! };
}

export function notificationRepoRoot(value: WireObject): string | undefined {
  return field(value, 'repoRoot', 'repo-root');
}
