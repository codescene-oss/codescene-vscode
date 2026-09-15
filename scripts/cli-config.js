/**
 * Shared configuration for CLI artifacts and version.
 * This JavaScript file is the single source of truth for CLI configuration.
 * It is used by:
 * - Build scripts (bundle-cli.js) that run before TypeScript compilation
 * - TypeScript source files (via artifact-info.ts) that import from this file
 */

const requiredDevtoolsVersion = '71112122d98c0589e680c937eddcaa2daa0e7030';

const artifacts = {
  darwin: {
    x64: `cs-ide-jre-macos-amd64-${requiredDevtoolsVersion}.zip`,
    arm64: `cs-ide-jre-macos-aarch64-${requiredDevtoolsVersion}.zip`,
  },
  linux: {
    x64: `cs-ide-jre-linux-amd64-${requiredDevtoolsVersion}.zip`,
    arm64: `cs-ide-jre-linux-aarch64-${requiredDevtoolsVersion}.zip`,
  },
  win32: {
    x64: `cs-ide-jre-windows-amd64-${requiredDevtoolsVersion}.zip`,
  },
};

const nativeOsNames = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const nativeArchNames = { x64: 'amd64', arm64: 'aarch64' };
const supportedNativeArtifacts = {
  'macos-amd64': true,
  'macos-aarch64': true,
  'linux-amd64': true,
  'linux-aarch64': true,
  'windows-amd64': true,
};

function nativeArtifactName(platform, arch) {
  const osName = nativeOsNames[platform];
  const archName = nativeArchNames[arch];
  const artifact = osName && archName && `${osName}-${archName}`;
  if (!supportedNativeArtifacts[artifact]) {
    throw new Error(`Unsupported platform/arch combination: ${platform}/${arch}`);
  }
  return `cs-ide-${artifact}-${requiredDevtoolsVersion}.zip`;
}

function nativeDistributionName(platform, arch) {
  return `cs-native-${platform}-${arch}`;
}

function nativeBinaryFileName(platform) {
  return platform === 'win32' ? 'cs-ide.exe' : 'cs-ide';
}

module.exports = {
  requiredDevtoolsVersion,
  artifacts,
  nativeArtifactName,
  nativeDistributionName,
  nativeBinaryFileName,
};
