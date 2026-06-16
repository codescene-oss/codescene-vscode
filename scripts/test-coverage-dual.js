const { execSync } = require('child_process');

execSync('c8 --clean npm run test', { stdio: 'inherit', env: process.env });
execSync('c8 --clean=false npm run test', {
  stdio: 'inherit',
  env: { ...process.env, BUILD_NO_ACE: 'true' },
});
execSync('c8 report', { stdio: 'inherit', env: process.env });
