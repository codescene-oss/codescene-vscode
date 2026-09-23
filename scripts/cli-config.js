/**
 * Shared configuration for CLI artifacts and version.
 * This JavaScript file is the single source of truth for CLI configuration.
 * It is used by:
 * - Build scripts (bundle-cli.js) that run before TypeScript compilation
 * - TypeScript source files (via artifact-info.ts) that import from this file
 */

const requiredDevtoolsVersion = '3c5dc7a5273e66de39db29c8560d2d7f28f2e09b';

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
