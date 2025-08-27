import { Baseline } from '../../cs-extension-state';
import { Delta } from '../../devtools-api/delta-model';
import { FileWithIssues } from '../tree-model';

/**
 * Convert VSCode commit baseline enum to CWF baseline string
 */
export function convertVSCodeCommitBaselineToCWF(baseline: Baseline) {
  const payloadConverter = ['HEAD', 'branchCreate', 'default'];
  return payloadConverter[baseline - 1];
}

/**
 * Convert CWF basleinetring to VSCode enum
 * @param commitBaselineString
 * @returns
 */
export function convertCWFCommitBaselineToVSCode(commitBaselineString: 'HEAD' | 'branchCreate' | 'default') {
  const payloadConverter = {
    HEAD: 1,
    branchCreate: 2,
    default: 3,
  };
  return payloadConverter[commitBaselineString];
}

/**
 * Convert VSCode FileWithIssues to CWF delta object
 * @param event
 * @returns
 */
export function convertFileIssueToCWFDeltaItem(event: FileWithIssues): { file: { fileName: string }; delta?: Delta } {
  return {
    file: {
      fileName: event.document.fileName,
    },
    delta: event.deltaForFile,
  };
}
function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function convertCWFDocTypeToVSCode(docType: string) {
  return capitalize(docType.replace('docs_', '').replace('issues_', '').replace(/_/g, ' '));
}
