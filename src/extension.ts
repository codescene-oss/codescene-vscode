// NOTE: please keep relative imports to a minimum here - just logging.
import * as vscode from 'vscode';
import axios from 'axios';
import { logOutputChannel } from './log';
import * as path from 'path';
import * as fs from 'fs';

async function isLegacyVersion(): Promise<boolean> {
  const extension = vscode.extensions.getExtension('codescene.codescene-vscode');
  const currentVersion = extension?.packageJSON.version;
  if (!currentVersion) {
    logOutputChannel.info('Could not determine extension version, allowing activation');
    return false;
  }

  // Check if this is a production build, by looking for the .cs-prod-build marker
  const extensionPath = extension?.extensionPath;
  if (extensionPath) {
    const markerPath = path.join(extensionPath, 'out', '.cs-prod-build');
    const isProdBuild = fs.existsSync(markerPath);

    if (!isProdBuild) {
      logOutputChannel.info('Running from local build, allowing activation');
      return false;
    } else {
      logOutputChannel.info('Running a production build');
    }
  }

  try {
    // File format: one version per line, e.g. 0.21.99
    const url = 'https://raw.githubusercontent.com/codescene-oss/codescene-vscode/main/deprecated_versions';

    const response = await axios.get(url, { timeout: 1000 });
    const lines = response.data.split('\n');
    const isDeprecated = lines.some((line: string) => line.trim() === currentVersion);
    if (isDeprecated) {
      logOutputChannel.info(`Version ${currentVersion} is deprecated, blocking activation`);
    } else {
      logOutputChannel.info(`Version ${currentVersion} is not deprecated, allowing activation`);
    }
    return isDeprecated;
  } catch (error) {
    logOutputChannel.info(`Error checking deprecated versions (${error}), allowing activation`);
    return false;
  }
}

let impl: typeof import('./extension-impl') | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const isDeprecated = await isLegacyVersion();
  if (isDeprecated) {
    void vscode.window.showWarningMessage(
      `The current CodeScene extension version is deprecated. Please update it to the latest version.`,
      'Update Now'
    ).then(selection => {
      if (selection === 'Update Now') {
        void vscode.commands.executeCommand('workbench.extensions.search', 'CodeScene.codescene-vscode');
      }
    });
    return;
  }

  impl = await import('./extension-impl');
  return impl.activate(context);
}

export function deactivate() {
  if (!impl) {
    return;
  }

  return impl.deactivate();
}
