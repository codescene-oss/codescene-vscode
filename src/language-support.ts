import vscode from 'vscode';
import { isDefined } from './utils';

const extToLanguageId = new Map<string, string | string[]>([
  ['js', 'javascript'],
  ['mjs', 'javascript'],
  ['sj', 'javascript'],

  ['jsx', 'javascriptreact'],

  ['ts', 'typescript'],
  ['tsx', 'typescriptreact'],

  ['cls', 'apex'],
  ['tgr', 'apex'],
  ['trigger', 'apex'],

  ['c', 'c'],

  ['clj', 'clojure'],
  ['cljc', 'clojure'],
  ['cljs', 'clojure'],

  ['cc', 'cpp'],
  ['cpp', 'cpp'],
  ['cxx', 'cpp'],
  ['h', 'cpp'],
  ['hh', 'cpp'],
  ['hpp', 'cpp'],
  ['hxx', 'cpp'],
  ['ipp', 'cpp'],

  ['m', 'objective-c'],
  ['mm', ['objective-c', 'objective-cpp']],

  ['cs', 'csharp'],
  ['erl', 'erlang'],
  ['go', 'go'],
  ['groovy', 'groovy'],
  ['java', 'java'],
  ['kt', 'kotlin'],
  ['php', 'php'],

  ['pm', ['perl', 'perl6']],
  ['pl', ['perl', 'perl6']],

  ['ps1', 'powershell'],
  ['psd1', 'powershell'],
  ['psm1', 'powershell'],

  ['py', 'python'],
  ['rb', 'ruby'],
  ['rs', 'rust'],
  ['swift', 'swift'],
  ['vb', 'vb'],
  ['vue', 'vue'],

  ['dart', 'dart'],
  ['scala', 'scala'],
]);

/**
 * @returns List of DocumentFilters for scheme 'file' for all cs supported languages
 */
export function reviewDocumentSelector(): vscode.DocumentSelector {
  const distinctLangIds = new Set<string>();
  for (let langId of extToLanguageId.values()) {
    if (Array.isArray(langId)) {
      langId.forEach((id) => distinctLangIds.add(id));
    } else {
      distinctLangIds.add(langId);
    }
  }

  return Array.from(distinctLangIds).map((langId) => ({ language: langId, scheme: 'file' }));
}

/**
 * Maps the preflight response file extensions* to langauge identifiers supported by vscode.
 * https://code.visualstudio.com/docs/languages/identifiers#_known-language-identifiers
 * *Extensions are from CodeScene's internal analysis library.
 *
 * This is used in determining what files to enable refactoring features for.
 */
export function fileTypeToLanguageId(fileType: string) {
  return extToLanguageId.get(fileType);
}

export function toDistinctLanguageIds(supportedFileTypes: string[]): string[] {
  const definedLangIds = supportedFileTypes.flatMap(fileTypeToLanguageId).filter(isDefined);
  return [...new Set(definedLangIds)];
}
