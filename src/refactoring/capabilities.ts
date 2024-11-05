import { DocumentSelector, TextDocument } from 'vscode';
import { toDistinctLanguageIds } from '../language-support';
import { PreFlightResponse, RefactorSupport } from './model';

export class RefactoringCapabilities {
  private languageSupport: Map<string, RefactorSupport> = new Map();

  constructor(private preFlight: PreFlightResponse) {
    this.preFlight['file-types'].forEach((fileType) => {
      const propsForFileType = this.preFlight['language-specific']?.[fileType];
      if (propsForFileType) {
        const support = { ...this.preFlight['language-common'], ...propsForFileType };
        this.languageSupport.set(fileType, support);
      }
    });
  }

  get documentSelector(): DocumentSelector {
    return toDistinctLanguageIds(this.preFlight['file-types']).map((language) => ({
      language,
      // scheme: 'file',
    }));
  }

  isSupported(codeSmell: string, document?: TextDocument) {
    const languageSpecificRule = document && this.languageSupport.get(document.languageId)?.['code-smells'];
    return languageSpecificRule || this.preFlight['language-common']['code-smells'].includes(codeSmell);
  }

  maxLocFor(document?: TextDocument) {
    const languageSpecificRule = document && this.languageSupport.get(document.languageId)?.['max-input-loc'];
    return languageSpecificRule || this.preFlight['max-input-loc'];
  }
}
