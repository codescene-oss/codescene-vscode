import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cliConfig = require('../scripts/cli-config.js');

// eslint-disable-next-line @typescript-eslint/naming-convention
export const requiredDevtoolsVersion = cliConfig.requiredDevtoolsVersion;

export class ArtifactInfo {
  constructor(readonly extensionPath: string) {}

  get absoluteBinaryPath() {
    return path.join(this.extensionPath, this.binaryName);
  }

  get absoluteExecutablePath() {
    return path.join(this.absoluteBinaryPath, cliConfig.nativeBinaryFileName(process.platform));
  }

  get binaryName(): string {
    return `cs-${process.platform}-${process.arch}`;
  }
}
