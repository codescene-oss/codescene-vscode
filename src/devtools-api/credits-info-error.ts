import { CreditsInfo } from './refactor-models';

export class CreditsInfoError extends Error {
  constructor(message: string, readonly creditsInfo: CreditsInfo, readonly traceId: string) {
    super(message);
  }
}
