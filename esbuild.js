const { build, context } = require('esbuild');
const { copy } = require('esbuild-plugin-copy');

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

const extensionConfig = {
  ...baseConfig,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'cjs',
  entryPoints: ['./src/extension.ts'],
  outfile: './out/main.js',
  external: ['vscode'],
  plugins: [buildCounter('extension')],
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
  if (args.includes('--watch')) {
    // Build and watch source code
    console.log('[watch] starting');
    const extContext = await context(extensionConfig);
    await extContext.watch();
    const webviewContext = await context(webviewConfig(true));
    await webviewContext.watch();
    console.log('[watch] active');
  } else {
    // Build source code
    await build(extensionConfig);
    await build(webviewConfig());
    console.log('[build] complete');
  }
})().catch((err) => {
  process.stderr.write(err);
  process.exit(1);
});
