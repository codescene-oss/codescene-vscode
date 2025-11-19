import * as path from 'path';
import { requiredDevtoolsVersion, artifacts } from './cli-config';

// eslint-disable-next-line @typescript-eslint/naming-convention
export { requiredDevtoolsVersion };

export { artifacts };

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
