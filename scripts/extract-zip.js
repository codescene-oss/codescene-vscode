const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);
const execOptions = { windowsHide: true, maxBuffer: 10 * 1024 * 1024 };

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function assertNoEscapingLinks(root, dir = root) {
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = path.resolve(dir, await fs.promises.readlink(entryPath));
      if (!isInside(root, target)) {
        throw new Error(`Archive entry ${path.relative(root, entryPath)} links outside the extraction directory`);
      }
    } else if (entry.isDirectory()) {
      await assertNoEscapingLinks(root, entryPath);
    }
  }
}

async function runExtractor(zipPath, destinationDir) {
  // Windows CI publishes zips via Compress-Archive; Expand-Archive reads those reliably.
  if (process.platform === 'win32') {
    const quote = (value) => value.replace(/'/g, "''");
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${quote(zipPath)}' -DestinationPath '${quote(destinationDir)}' -Force`],
      execOptions
    );
    return;
  }
  await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', destinationDir], execOptions);
}

async function extractZipArchive(zipPath, destinationDir) {
  const root = path.resolve(destinationDir);
  await fs.promises.mkdir(root, { recursive: true });
  await runExtractor(path.resolve(zipPath), root);
  await assertNoEscapingLinks(root);
}

module.exports = { extractZipArchive };
