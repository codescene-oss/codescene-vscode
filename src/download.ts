import * as fs from 'fs';
import { cpus } from 'os';
import { getConfiguration } from './configuration';
import { CsIdeServerClient } from './devtools-api/ide-server-client';
import { logOutputChannel } from './log';
import { ArtifactInfo, requiredDevtoolsVersion } from './artifact-info';

export { requiredDevtoolsVersion };

function getBundledBinaryPath(extensionPath: string): string {
  return new ArtifactInfo(extensionPath).absoluteBinaryPath;
}

function bundledDistributionExists(extensionPath: string, binaryPath: string): boolean {
  const artifact = new ArtifactInfo(extensionPath);
  return fs.existsSync(binaryPath) && fs.existsSync(artifact.absoluteJavaPath) && fs.existsSync(artifact.absoluteJarPath);
}

async function verifyBinaryVersion(client: CsIdeServerClient): Promise<boolean> {
  const metadata = await client.start();
  const expectedVersion = process.env.CS_IDE_REQUIRED_VERSION ?? requiredDevtoolsVersion;
  const isValid = metadata.sha === expectedVersion;
  if (isValid) logOutputChannel.debug(`Using CodeScene CLI version '${metadata.version}' (${metadata.sha}).`);
  return isValid;
}

function createIdeServer(binaryPath: string): CsIdeServerClient {
  const configuredThreads = getConfiguration<number>('serverWorkerThreads', 0) ?? 0;
  const threads = Number.isInteger(configuredThreads) && configuredThreads > 0
    ? configuredThreads
    : Math.max(1, Math.floor(cpus().length / 2));
  return CsIdeServerClient.fromDistribution(binaryPath, ['server', '--threads', String(threads)]);
}

export async function ensureCompatibleBinary(extensionPath: string): Promise<string> {
  const client = await ensureCompatibleIdeServer(extensionPath);
  client.dispose();
  return client.binaryPath;
}

export async function ensureCompatibleIdeServer(extensionPath: string): Promise<CsIdeServerClient> {
  logOutputChannel.info('Checking for bundled CodeScene devtools binary...');
  const binaryPath = getBundledBinaryPath(extensionPath);
  if (!bundledDistributionExists(extensionPath, binaryPath)) {
    throw new Error(`The cs-ide distribution "${binaryPath}" is incomplete. This should be bundled with the extension during the build process.`);
  }
  const client = createIdeServer(binaryPath);
  let isValid = false;
  try {
    isValid = await verifyBinaryVersion(client);
  } catch (error) {
    client.dispose();
    throw error;
  }
  if (!isValid) {
    client.dispose();
    const expectedVersion = process.env.CS_IDE_REQUIRED_VERSION ?? requiredDevtoolsVersion;
    throw new Error(
      `The cs-ide distribution version does not match the required version ${expectedVersion}. ` +
        `For a local CLI build, set CS_IDE_REQUIRED_VERSION to the SHA from \`cs-ide version --sha\` ` +
        `(e.g. in .vscode/launch.json env when using F5).`
    );
  }
  logOutputChannel.info('CodeScene devtools binary is ready.');
  return client;
}
