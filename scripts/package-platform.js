#!/usr/bin/env node

/**
 * Package the extension for a specific platform/architecture.
 * This script bundles the CLI binary for the specified platform and creates a platform-specific VSIX.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const artifacts = {
  darwin: ['x64', 'arm64'],
  linux: ['x64', 'arm64'],
  win32: ['x64'],
};

function cleanupOtherBinaries(targetPlatform, targetArch) {
  const projectRoot = path.join(__dirname, '..');
  console.log(`Cleaning up binaries for other platforms...`);
  
  // Keep only the target binary
  const targetBinary = `cs-${targetPlatform}-${targetArch}${targetPlatform === 'win32' ? '.exe' : ''}`;
  
  // Remove all other binaries
  for (const [platform, arches] of Object.entries(artifacts)) {
    for (const arch of arches) {
      const binaryName = `cs-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
      const binaryPath = path.join(projectRoot, binaryName);
      
      if (binaryName !== targetBinary && fs.existsSync(binaryPath)) {
        fs.unlinkSync(binaryPath);
        console.log(`  Removed: ${binaryName}`);
      }
    }
  }
}

function updateVscodeIgnore(targetPlatform, targetArch, originalContent) {
  const vscodeIgnorePath = path.join(__dirname, '..', '.vscodeignore');
  const targetBinary = `cs-${targetPlatform}-${targetArch}${targetPlatform === 'win32' ? '.exe' : ''}`;
  
  // Read current .vscodeignore if original not provided
  let content = originalContent || fs.readFileSync(vscodeIgnorePath, 'utf8');
  
  // Remove all binary includes
  content = content.replace(/!cs-.*\n/g, '');
  
  // Add the target binary
  const lines = content.split('\n');
  const zipLineIndex = lines.findIndex(line => line.trim() === '*.zip');
  
  if (zipLineIndex >= 0) {
    lines.splice(zipLineIndex + 1, 0, `!${targetBinary}`);
  } else {
    lines.push(`!${targetBinary}`);
  }
  
  fs.writeFileSync(vscodeIgnorePath, lines.join('\n'));
  console.log(`Updated .vscodeignore to include only: ${targetBinary}`);
  
  return content; // Return original content for restoration
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node package-platform.js <platform> <arch>');
    console.error('Example: node package-platform.js darwin arm64');
    console.error('');
    console.error('Supported platforms:');
    for (const [platform, arches] of Object.entries(artifacts)) {
      console.error(`  ${platform}: ${arches.join(', ')}`);
    }
    process.exit(1);
  }
  
  const platform = args[0];
  const arch = args[1];
  
  if (!artifacts[platform] || !artifacts[platform].includes(arch)) {
    console.error(`❌ Unsupported platform/arch: ${platform}/${arch}`);
    process.exit(1);
  }
  
  console.log(`📦 Packaging extension for ${platform}/${arch}...\n`);
  
  const vscodeIgnorePath = path.join(__dirname, '..', '.vscodeignore');
  const originalVscodeIgnore = fs.readFileSync(vscodeIgnorePath, 'utf8');
  
  try {
    // Step 1: Bundle binary for this platform
    console.log('Step 1: Bundling CLI binary...');
    execSync(`node ./scripts/bundle-cli.js ${platform} ${arch}`, { stdio: 'inherit' });
    
    // Step 2: Clean up other binaries
    console.log('\nStep 2: Cleaning up other platform binaries...');
    cleanupOtherBinaries(platform, arch);
    
    // Step 3: Update .vscodeignore
    console.log('\nStep 3: Updating .vscodeignore...');
    updateVscodeIgnore(platform, arch, originalVscodeIgnore);
    
    // Step 4: Build extension
    console.log('\nStep 4: Building extension...');
    execSync('npm run build', { stdio: 'inherit' });
    
    // Step 5: Package VSIX
    console.log('\nStep 5: Packaging VSIX...');
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    const target = `${platform}-${arch}`;
    const vsixName = `codescene-vscode-${version}-${target}.vsix`;
    
    execSync(`vsce package --target ${target} --no-yarn --out ${vsixName}`, { 
      stdio: 'inherit',
      env: { ...process.env, GITHUB_TOKEN: process.env.GITHUB_TOKEN || '' }
    });
    
    console.log(`\n✅ Successfully created: ${vsixName}`);
    
  } catch (error) {
    console.error('\n❌ Failed to package:', error.message);
    process.exit(1);
  } finally {
    // Restore original .vscodeignore
    console.log('\nRestoring .vscodeignore...');
    fs.writeFileSync(vscodeIgnorePath, originalVscodeIgnore);
  }
}

if (require.main === module) {
  main();
}

module.exports = { cleanupOtherBinaries, updateVscodeIgnore };




