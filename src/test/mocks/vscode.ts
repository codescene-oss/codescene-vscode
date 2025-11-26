/* eslint-disable @typescript-eslint/naming-convention */

import { MockTextDocument } from './mock-text-document';

export async function openTextDocument(options: { content: string; language: string }) {
  return new MockTextDocument(options.content, options.language);
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}
