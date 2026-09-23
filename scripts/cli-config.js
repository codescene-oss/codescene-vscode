/**
 * Shared configuration for CLI artifacts and version.
 * This JavaScript file is the single source of truth for CLI configuration.
 * It is used by:
 * - Build scripts (bundle-cli.js) that run before TypeScript compilation
 * - TypeScript source files (via artifact-info.ts) that import from this file
 */

const requiredDevtoolsVersion = '3c5dc7a5273e66de39db29c8560d2d7f28f2e09b';

const nativeOsNames = { darwin: 'macos', linux: 'linux', win32: 'windows' };
const nativeArchNames = { x64: 'amd64', arm64: 'aarch64' };

function nativeBinaryFileName(platform) {
  return platform === 'win32' ? 'cs-ide.exe' : 'cs-ide';
}

/**
 * Files that must ship next to the native binary for it to work.
 * macOS library validation rejects the unsigned copy of the JNA library that the
 * CLI would otherwise unpack at runtime, which leaves the file watcher dead, so
 * the signed copy has to travel with the binary.
 */
function requiredSidecarFileNames(platform) {
  return platform === 'darwin' ? ['libjnidispatch.jnilib'] : [];
}

function nativeArtifactName(platform, arch) {
  const osName = nativeOsNames[platform];
  const archName = nativeArchNames[arch];
  if (!osName || !archName) {
    throw new Error(`Unsupported platform/arch combination: ${platform}/${arch}`);
  }
  return `cs-ide-${osName}-${archName}-${requiredDevtoolsVersion}.zip`;
}

const artifacts = {
  darwin: {
    x64: nativeArtifactName('darwin', 'x64'),
    arm64: nativeArtifactName('darwin', 'arm64'),
  },
  linux: {
    x64: nativeArtifactName('linux', 'x64'),
    arm64: nativeArtifactName('linux', 'arm64'),
  },
  win32: {
    x64: nativeArtifactName('win32', 'x64'),
  },
};

module.exports = {
  requiredDevtoolsVersion,
  artifacts,
  nativeBinaryFileName,
  requiredSidecarFileNames,
};
