// Build a lookuptable to separate all the messages from webview into smaller categories
const lifecycleMessages = ['init'] as const;
const loginMessages = ['open-login', 'open-home', 'init-login'] as const;
const panelMessages = ['request-and-present-refactoring', 'open-docs-for-function'] as const;
const editorMessages = ['goto-function-location', 'open-settings'] as const;
const analysisMessages = ['stop-analysis', 'start-analysis'] as const;

const categorySets = {
  lifecycle: new Set<string>(lifecycleMessages),
  login: new Set<string>(loginMessages),
  panel: new Set<string>(panelMessages),
  editor: new Set<string>(editorMessages),
  analysis: new Set<string>(analysisMessages),
} as const;

type MessageCategory = keyof typeof categorySets;

// Build a lookup table once
const messageToCategoryLokup = (() => {
  const map = new Map<string, MessageCategory>();
  for (const [category, set] of Object.entries(categorySets) as Array<[MessageCategory, Set<string>]>) {
    for (const msg of set) {
      map.set(msg, category);
    }
  }
  return map;
})();

/**
 * Get message category from messageType
 * @param message
 * @returns
 */
export function getMessageCategory(message: string): MessageCategory | 'unknown' {
  return messageToCategoryLokup.get(message) ?? 'unknown';
}
