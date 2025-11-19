import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cliConfig = require('../scripts/cli-config.js');

// eslint-disable-next-line @typescript-eslint/naming-convention
export const requiredDevtoolsVersion: string = cliConfig.requiredDevtoolsVersion;

export const artifacts: { [platform: string]: { [arch: string]: string } } = cliConfig.artifacts;

export class ArtifactInfo {
  constructor(readonly extensionPath: string) {}

  get absoluteDownloadPath() {
    return path.join(this.extensionPath, this.artifactName);
  }

  get absoluteBinaryPath() {
    return path.join(this.extensionPath, this.binaryName);
  }

  get artifactName() {
    const artifactName = artifacts[process.platform]?.[process.arch];
    if (!artifactName) {
      throw Error(`Unsupported platform: ${process.platform}-${process.arch}`);
    }
    return artifactName;
  }

  get binaryName(): string {
    // E.g. cs-darwin-x64/arm64, cs-linux-x64, cs-win32-x64.exe
    return `cs-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
  }
}
