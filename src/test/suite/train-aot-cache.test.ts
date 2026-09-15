import * as assert from 'assert';
import * as path from 'path';

const trainAotCache = require('../../../scripts/train-aot-cache');

suite('Train AOT Cache Script Test Suite', () => {
  const java = 'java.exe';
  const jar = path.join('dist', 'cs-ide.jar');
  const cache = path.join('dist', 'cs-ide.aot');

  test('places AOTCacheOutput before -jar, caps the train heap, and never sets AOTMode=on', () => {
    const command = trainAotCache.trainCommand({ java, jar, cachePath: cache });
    assert.deepStrictEqual(command, [
      java,
      '-Xmx512m',
      '--enable-native-access=ALL-UNNAMED',
      `-XX:AOTCacheOutput=${cache}`,
      '-jar',
      jar,
      'server',
      '--threads',
      '2',
    ]);
    assert.ok(!command.some((arg: string) => arg.includes('AOTMode=on')));
  });

  test('verify spawn loads AOTCache and never forces AOTMode=on', () => {
    const command = trainAotCache.productionCommand({ java, jar, cachePath: cache });
    assert.deepStrictEqual(command, [
      java,
      '--enable-native-access=ALL-UNNAMED',
      `-XX:AOTCache=${cache}`,
      '-jar',
      jar,
      'server',
      '--threads',
      '2',
    ]);
    assert.ok(!command.some((arg: string) => arg.includes('AOTMode=on')));
  });

  test('keeps the cache file beside the jar', () => {
    assert.strictEqual(trainAotCache.cachePath(jar), cache);
  });
});
