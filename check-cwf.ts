import fs from 'fs';
import { execSync } from 'child_process';

const cwfPath = './cs-cwf';

function hasCwfFolder(): boolean {
  if (!fs.existsSync(cwfPath)) return false;

  // Optional: check if folder is empty or missing key files
  const files = fs.readdirSync(cwfPath);
  return files.length > 0;
}

if (!hasCwfFolder()) {
  console.log('[setup] cs-cwf folder missing. Running `npm run updatecwf`...');
  try {
    execSync('npm run updatecwf', { stdio: 'inherit' });
  } catch (err) {
    console.error('[setup] Failed to fetch cs-cwf:', err);
    process.exit(1);
  }
} else {
  console.log('[setup] cs-cwf already present. Skipping update.');
}
