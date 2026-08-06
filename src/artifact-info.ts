import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cliConfig = require('../scripts/cli-config.js');

// eslint-disable-next-line @typescript-eslint/naming-convention
export const requiredDevtoolsVersion = cliConfig.requiredDevtoolsVersion;

export const artifacts: { [platform: string]: { [arch: string]: string } } = cliConfig.artifacts;

export class ArtifactInfo {
  constructor(readonly extensionPath: string) {}

  get absoluteDownloadPath() {
    return path.join(this.extensionPath, this.artifactName);
  }

  get absoluteBinaryPath() {
    return path.join(this.extensionPath, this.binaryName);
  }

  get absoluteJavaPath() {
    return path.join(this.absoluteBinaryPath, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  }

  get absoluteJarPath() {
    return path.join(this.absoluteBinaryPath, 'cs-ide.jar');
  }

  get artifactName() {
    const artifactName = artifacts[process.platform]?.[process.arch];
    if (!artifactName) {
      throw Error(`Unsupported platform: ${process.platform}-${process.arch}`);
    }
    return artifactName;
  }

  get binaryName(): string {
    return `cs-${process.platform}-${process.arch}`;
  }
}
