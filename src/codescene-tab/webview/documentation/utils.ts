// Ensure the string is using the correct docs_issues_complex_method format no matter where the calls comes from (codelens/monitor)
export function getCWFDocType(docType: string) {
  if (docType.includes('_')) return docType;
  return `docs_issues_${docType.toLowerCase().split(' ').join('_').replace(',', '')}`;
}
