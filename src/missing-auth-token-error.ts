export class MissingAuthTokenError extends Error {
  constructor() {
    super('Token not available for refactoring operation');
  }
}
