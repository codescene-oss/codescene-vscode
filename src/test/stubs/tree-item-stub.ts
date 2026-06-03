export class TreeItemStub {
  label?: string;
  collapsibleState?: number;
  iconPath?: unknown;
  tooltip?: string;
  command?: unknown;
  resourceUri?: unknown;

  constructor(label?: string | unknown, collapsibleState?: number) {
    if (typeof label === 'string') {
      this.label = label;
    } else if (label && typeof label === 'object') {
      this.resourceUri = label;
    }
    this.collapsibleState = collapsibleState;
  }
}
