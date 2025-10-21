import fs from 'fs';
import { execSync } from 'child_process';
import os from 'os';

const cwfPath = './cs-cwf';

function isMac() {
  return os.platform() === 'darwin';
}

function hasCwfFolder(): boolean {
  if (!fs.existsSync(cwfPath)) return false;

  // Optional: check if folder is empty or missing key files
  const files = fs.readdirSync(cwfPath);
  return files.length > 0;
}

if (!hasCwfFolder()) {
  if (!isMac()) {
    console.log('[setup] Skipping cs-cwf fetch on non-macOS platforms.');
  } else {
    console.log('[setup] cs-cwf folder missing. Running `npm run updatecwf`...');
    try {
      execSync('npm run updatecwf', { stdio: 'inherit' });
    } catch (err) {
      console.error('[setup] Failed to fetch cs-cwf:', err);
      process.exit(1);
    }
  }
} else {
  console.log('[setup] cs-cwf already present. Skipping update.');
}
