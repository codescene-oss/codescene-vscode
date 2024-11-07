import { DocumentSelector, TextDocument } from 'vscode';
import { fileTypeToLanguageId, toDistinctLanguageIds } from '../language-support';
import { PreFlightResponse, RefactorSupport } from './model';

export class RefactoringCapabilities {
  
  // Maps vscode languageIds (note - NOT "file-type") to a specific RefactorSupport
  private languageSupport: Map<string, RefactorSupport> = new Map();

  constructor(private preFlight: PreFlightResponse) {
    this.initLanguageSpecificSupport();
  }

  private initLanguageSpecificSupport() {
    this.preFlight['file-types'].forEach((fileType) => {
      const propsForFileType = this.preFlight['language-specific']?.[fileType];
      const languageId = fileTypeToLanguageId(fileType);
      if (propsForFileType && languageId) {
        const support = { ...this.preFlight['language-common'], ...propsForFileType };
        if (Array.isArray(languageId)) {
          languageId.forEach((id) => this.languageSupport.set(id, support));
        } else {
          this.languageSupport.set(languageId, support);
        }
      }
    });
  }

  get documentSelector(): DocumentSelector {
    return toDistinctLanguageIds(this.preFlight['file-types']).map((language) => ({
      language,
    }));
  }

  /**
   * 
   * @param codeSmell is this code smell supported?
   * @param document optional document if checking language-specific support
   * @returns 
   */
  isSupported(codeSmell: string, document?: TextDocument) {
    const languageSpecificRule = document && this.languageSupport.get(document.languageId)?.['code-smells'];
    const rule = languageSpecificRule || this.preFlight['language-common']['code-smells'];
    return rule.includes(codeSmell);
  }

  maxLocFor(document?: TextDocument) {
    const languageSpecificRule = document && this.languageSupport.get(document.languageId)?.['max-input-loc'];
    return languageSpecificRule || this.preFlight['max-input-loc'];
  }
}
