import vscode from 'vscode';
import { RefactoringSupport } from './cs-rest-api';
import { isDefined } from './utils';

function getSupportedLanguages(extension: vscode.Extension<any>): string[] {
  return extension.packageJSON.activationEvents
    .filter((event: string) => event.startsWith('onLanguage:'))
    .map((event: string) => event.substring(11));
}

/**
 *
 * @param supportedLanguages
 * @returns List of DocumentFilters for scheme 'file' for all cs supported languages
 */
export function toReviewDocumentSelector(extension: vscode.Extension<any>): vscode.DocumentSelector {
  return getSupportedLanguages(extension).map((language) => ({ language, scheme: 'file' }));
}

/**
 * Maps the preflight response file extensions* to langauge identifiers supported by vscode.
 * https://code.visualstudio.com/docs/languages/identifiers#_known-language-identifiers
 * *Extensions are from CodeScene's internal analysis library.
 *
 * This is used in determining what files to enable refactoring features for.
 */
function fileTypeToLanguageId(fileType: string) {
  const map = new Map<string, string | string[]>();
  map.set('js', 'javascript');
  map.set('mjs', 'javascript');
  map.set('sj', 'javascript');

  map.set('jsx', 'javascriptreact');

  map.set('ts', 'typescript');
  map.set('tsx', 'typescriptreact');

  map.set('cls', 'apex');
  map.set('tgr', 'apex');
  map.set('trigger', 'apex');

  map.set('c', 'c');

  map.set('clj', 'clojure');
  map.set('cljc', 'clojure');
  map.set('cljs', 'clojure');

  map.set('cc', 'cpp');
  map.set('cpp', 'cpp');
  map.set('cxx', 'cpp');
  map.set('h', 'cpp');
  map.set('hh', 'cpp');
  map.set('hpp', 'cpp');
  map.set('hxx', 'cpp');
  map.set('ipp', 'cpp');

  map.set('m', 'objective-c');
  map.set('mm', ['objective-c', 'objective-cpp']);

  map.set('cs', 'csharp');
  map.set('erl', 'erlang');
  map.set('go', 'go');
  map.set('groovy', 'groovy');
  map.set('java', 'java');
  map.set('kt', 'kotlin');
  map.set('php', 'php');

  map.set('pm', ['perl', 'perl6']);
  map.set('pl', ['perl', 'perl6']);

  map.set('ps1', 'powershell');
  map.set('psd1', 'powershell');
  map.set('psm1', 'powershell');

  map.set('py', 'python');
  map.set('rb', 'ruby');
  map.set('rs', 'rust');
  map.set('swift', 'swift');
  map.set('vb', 'vb');
  map.set('vue', 'vue');

  return map.get(fileType);
}

/**
 *
 * @param refactoringSupport
 * @returns A list of distinct DocumentSelectors for the supported file types
 */
export function toRefactoringDocumentSelector(refactoringSupport: RefactoringSupport): vscode.DocumentSelector {
  const definedLangIds = refactoringSupport['file-types'].flatMap(fileTypeToLanguageId).filter(isDefined);
  return [...new Set(definedLangIds)].map((language) => ({
    language,
    scheme: 'file',
  }));
}
