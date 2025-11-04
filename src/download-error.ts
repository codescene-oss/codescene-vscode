export class DownloadError extends Error {
  constructor(message: string, readonly url: URL, readonly expectedCliPath: string) {
    super(message);
  }
}
