import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const REQUIRED_DEVTOOLS_VERSION = 'fafb2c42da8b9a314be29e626f653135e6d2c771';

export const artifacts: { [platform: string]: { [arch: string]: string } } = {
  darwin: {
    x64: `cs-ide-macos-amd64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
    arm64: `cs-ide-macos-aarch64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
  },
  linux: {
    x64: `cs-ide-linux-amd64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
    arm64: `cs-ide-linux-aarch64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
  },
  win32: {
    x64: `cs-ide-windows-amd64-${REQUIRED_DEVTOOLS_VERSION}.zip`,
  },
};

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
