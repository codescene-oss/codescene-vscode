const { build, context } = require('esbuild');
const { copy } = require('esbuild-plugin-copy');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const baseConfig = {
  bundle: true,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
};

function buildCounter(counterName) {
  return {
    name: 'custom-buildcount-plugin',
    setup: (build) => {
      let count = 0;
      build.onEnd((result) => {
        const warningOrError = result.errors.length > 0 || result.warnings.length > 0 ? '❌' : '';
        console.log(`${new Date().toLocaleTimeString()} [${counterName}] build #${count} ${warningOrError}`);
        count++;
      });
    },
  };
}

const PROD_BUILD_MARKER_PATH = path.join(__dirname, 'out', '.cs-prod-build');

function createProdBuildMarker() {
  return {
    name: 'create-prod-build-marker',
    setup(build) {
      build.onEnd(() => {
        if (process.env.CI === 'true' || process.env.CI === '1') {
          fs.writeFileSync(PROD_BUILD_MARKER_PATH, '');
          console.log('Created .cs-prod-build marker file');
        }
      });
    },
  };
}

const extensionConfig = {
  ...baseConfig,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'cjs',
  entryPoints: ['./src/extension.ts'],
  outfile: './out/main.js',
  external: ['vscode'],
  plugins: [
    buildCounter('extension'),
    createProdBuildMarker(),
  ],
};

function webviewConfig(watch = false) {
  return {
    ...baseConfig,
    target: 'es2020',
    format: 'esm',
    entryPoints: [
      './src/code-health-monitor/details/webview-script.ts',
      './src/control-center/webview-script.ts',
      './src/codescene-tab/webview/script.ts',
      './src/codescene-tab/webview/ace-acknowledgement-script.ts',
      './src/codescene-tab/webview/refactoring-script.ts',
      './src/codescene-tab/webview/documentation-script.ts',
    ],
    outdir: './out',
    plugins: [
      buildCounter('webview-scripts'),
      copy({
        resolveFrom: 'out',
        assets: {
          from: [
            './node_modules/@vscode/codicons/dist/codicon.css',
            './node_modules/@vscode/codicons/dist/codicon.ttf',
          ],
          to: ['./codicons'],
          watch,
        },
      }),
      copy({
        resolveFrom: 'out',
        assets: {
          from: 'src/**/*.css',
          to: './',
          watch,
        },
        verbose: false,
      }),
    ],
  };
}

(async () => {
  const args = process.argv.slice(2);

  if (fs.existsSync(PROD_BUILD_MARKER_PATH)) {
    fs.unlinkSync(PROD_BUILD_MARKER_PATH);
  }

  if (args.includes('--watch')) {
    // Build and watch source code
    console.log('[watch] starting');
    const extContext = await context(extensionConfig);
    await extContext.watch();
    const webviewContext = await context(webviewConfig(true));
    await webviewContext.watch();
    console.log('[watch] active');
  } else {
    console.log('[tsc] running type check...');
    execSync('npx tsc --noEmit', { stdio: 'inherit' }); // execSync throws an error on non-zero exit code
    console.log('[tsc] type check passed');

    console.log('[lint] running linter...');
    execSync('npm run lint', { stdio: 'inherit' }); // execSync throws an error on non-zero exit code
    console.log('[lint] linter passed');

    // Build source code
    console.log('[build] building...');
    await build(extensionConfig);
    await build(webviewConfig());
    console.log('[build] complete');
  }
})().catch((err) => {
  process.stderr.write(err);
  process.exit(1);
});
