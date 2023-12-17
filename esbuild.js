const { build, context } = require('esbuild');

const baseConfig = {
  bundle: true,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
};

const extensionConfig = {
  ...baseConfig,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'cjs',
  entryPoints: ['./src/extension.ts'],
  outfile: './out/main.js',
  external: ['vscode'],
};

const webviewConfig = {
  ...baseConfig,
  target: 'es2020',
  format: 'esm',
  entryPoints: ['./src/refactoring/webview-script.ts'],
  outfile: './out/webview-script.js',
};

const plugins = [
  {
    name: 'my-watcher',
    setup(build) {
      let count = 0;
      build.onEnd((result) => {
        console.log(new Date().toLocaleTimeString() + '[watch] build #' + count + ':', result);
        count++;
      });
    },
  },
];

(async () => {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--watch')) {
      // Build and watch source code
      console.log('[watch] starting');
      const extContext = await context({
        ...extensionConfig,
        plugins,
      });
      await extContext.watch();
      const webviewContext = await context({
        ...webviewConfig,
        plugins,
      });
      await webviewContext.watch();
      console.log('[watch] active');
    } else {
      // Build source code
      await build(extensionConfig);
      await build(webviewConfig);
      console.log('[build] complete');
    }
  } catch (err) {
    process.stderr.write(err.stderr);
    process.exit(1);
  }
})();
