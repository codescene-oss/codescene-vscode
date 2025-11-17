const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const sourcePath = join(__dirname, '..', 'package.json');
const patchedPath = join(__dirname, '..', 'out-instrumented', 'package.json');

const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
const patched = { ...source };

if (patched.main && patched.main.startsWith('./out/')) {
    patched.main = patched.main.replace('./out/', './out-instrumented/');
}

writeFileSync(patchedPath, JSON.stringify(patched, null, 2), 'utf8');

console.log('Patched package.json for out-instrumented');