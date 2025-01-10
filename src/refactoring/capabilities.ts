import { DocumentSelector, languages, Range, TextDocument } from 'vscode';
import { DevtoolsAPI } from '../devtools-interop/api';
import { EnclosingFn } from '../devtools-interop/model';
import { logOutputChannel } from '../log';
import { PreFlightResponse, RefactorSupport } from './model';
import { RefactoringRequest } from './request';
import { getFileExtension } from '../utils';

export interface FnToRefactor {
  name: string;
  range: Range;
  content: string;
  filePath: string;
  functionType: string;
  codeSmells: FnCodeSmell[];
}

interface FnCodeSmell {
  category: string;
  relativeStartLine: number;
  relativeEndLine: number;
}

export interface RefactoringTarget {
  line: number; // 1-indexed line numbers (from Devtools API)
  category: string;
}

export class RefactoringCapabilities {
  constructor(private preFlight: PreFlightResponse, private devtoolsAPI: DevtoolsAPI) {}

  get documentSelector(): DocumentSelector {
    return this.preFlight['file-types'].map((fileType) => ({ scheme: 'file', pattern: `**/*.${fileType}` }));
  }

  /**
   *
   * @param codeSmell is this code smell supported?
   * @returns
   */
  isSupported(codeSmell: string, document: TextDocument) {
    const rule =
      this.preFlight['language-specific']?.[getFileExtension(document.fileName)]?.['code-smells'] ||
      this.preFlight['language-common']['code-smells'];
    return rule.includes(codeSmell);
  }

  maxLocFor(document: TextDocument) {
    const maxLoc =
      this.preFlight['language-specific']?.[getFileExtension(document.fileName)]?.['max-input-loc'] ||
      this.preFlight['language-common']['max-input-loc'];
    return maxLoc;
  }

  async getFunctionsToRefactor(document: TextDocument, refactoringTargets: RefactoringTarget[]) {
    return await this.supportedDistinctFnsToRefactor(document, refactoringTargets);
  }

  initiateRefactoringForFunction(document: TextDocument, fnToRefactor: FnToRefactor) {
    if (languages.match(this.documentSelector, document) === 0) return;
    return new RefactoringRequest(fnToRefactor, document);
  }

  private async supportedDistinctFnsToRefactor(document: TextDocument, refactoringTargets: RefactoringTarget[]) {
    if (languages.match(this.documentSelector, document) === 0) return;
    return await this.findFunctionsToRefactor(document, refactoringTargets);
  }

  private async findFunctionsToRefactor(document: TextDocument, refactoringTargets: RefactoringTarget[]) {
    const supportedTargets = refactoringTargets.filter((d: RefactoringTarget) =>
      this.isSupported(d.category, document)
    );

    const distinctSupportedLines = new Set(supportedTargets.map((d: RefactoringTarget) => d.line));
    if (distinctSupportedLines.size === 0) return;

    const enclosingFnsWithSupportedSmells = await this.devtoolsAPI.enclosingFunctions(
      document.fileName,
      [...distinctSupportedLines],
      document.getText()
    );

    const maxInputLoc = this.maxLocFor(document);
    return enclosingFnsWithSupportedSmells
      .filter((enclosingFn) => {
        const activeLoc = enclosingFn['active-code-size'];
        if (activeLoc <= maxInputLoc) return true;
        logOutputChannel.debug(
          `Function "${enclosingFn.name}" exceeds max-input-loc (${activeLoc} > ${maxInputLoc}) - ignoring`
        );
        return false;
      })
      .map((enclosingFn) => toFnToRefactor(enclosingFn, document, refactoringTargets))
      .sort((a, b) => linesOfCode(a.range) - linesOfCode(b.range));
  }
}

function linesOfCode(range: Range) {
  // Maybe evident, but worth noting that function with a single line has a loc of 1 :)
  return range.end.line - range.start.line + 1;
}

function toFnToRefactor(enclosingFn: EnclosingFn, document: TextDocument, refactoringTargets: RefactoringTarget[]) {
  const range = rangeFromEnclosingFn(enclosingFn);
  const codeSmells = targetsInRange(refactoringTargets, range);
  return {
    name: enclosingFn.name,
    range,
    functionType: enclosingFn['function-type'],
    filePath: document.fileName,
    content: document.getText(range),
    codeSmells,
  } as FnToRefactor;
}

function targetsInRange(refactoringTargets: RefactoringTarget[], fnRange: Range) {
  return refactoringTargets
    .filter((target) => target.line >= fnRange.start.line + 1 && target.line <= fnRange.end.line + 1)
    .map((target) => {
      return {
        category: target.category,
        relativeStartLine: target.line - (fnRange.start.line + 1),
        relativeEndLine: fnRange.end.line + 1 - target.line,
      } as FnCodeSmell;
    });
}

// Note that vscode.Range line numbers are zero-based, while the CodeScene API uses 1-based line numbers
function rangeFromEnclosingFn(enclosingFn: EnclosingFn) {
  return new Range(
    enclosingFn['start-line'] - 1,
    enclosingFn['start-column'],
    enclosingFn['end-line'] - 1,
    enclosingFn['end-column']
  );
}

// export for test
export { rangeFromEnclosingFn, targetsInRange };
