import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const packagePlatform = require('../../../scripts/package-platform');

const vscodeIgnorePath = path.resolve(__dirname, '../../..', '.vscodeignore');
const committedVscodeIgnore = fs.readFileSync(vscodeIgnorePath, 'utf8');

function lineList(text: string): string[] {
  return text.split(/\r?\n/);
}

suite('Package Platform Script Test Suite', () => {
  test('exports applyVscodeIgnoreExceptions alongside the existing helpers', () => {
    assert.strictEqual(typeof packagePlatform.applyVscodeIgnoreExceptions, 'function');
    assert.strictEqual(typeof packagePlatform.updateVscodeIgnore, 'function');
    assert.strictEqual(typeof packagePlatform.cleanupOtherBinaries, 'function');
  });

  test('the committed .vscodeignore lists !cs-cwf/ and !cs-cwf/** after cs-*', () => {
    const lines = lineList(committedVscodeIgnore);
    const csGlob = lines.indexOf('cs-*');
    assert.ok(csGlob >= 0, 'cs-* line present');
    assert.strictEqual(lines.filter(l => l === '!cs-cwf/').length, 1);
    assert.strictEqual(lines.filter(l => l === '!cs-cwf/**').length, 1);
    assert.ok(lines.indexOf('!cs-cwf/') > csGlob);
    assert.ok(lines.indexOf('!cs-cwf/**') > csGlob);
  });

  const inputs: { name: string; content: string; targetBinary: string }[] = [
    { name: 'the committed .vscodeignore', content: committedVscodeIgnore, targetBinary: 'cs-win32-x64' },
    {
      name: 'a text with stale !cs-darwin-arm64/ lines',
      content: 'out/test/**\ncs-*\n*.zip\n!cs-darwin-arm64/\n!cs-darwin-arm64/**\n\n.mocharc.json\n',
      targetBinary: 'cs-linux-x64',
    },
    {
      name: 'a text with stale !cs-cwf/ lines',
      content: 'cs-*\n*.zip\n!cs-cwf/\n!cs-cwf/**\n!cs-darwin-x64/\n!cs-darwin-x64/**\n.mocharc.json\n',
      targetBinary: 'cs-darwin-x64',
    },
    {
      name: 'a text without *.zip',
      content: 'out/test/**\ncs-*\n\n.mocharc.json\n',
      targetBinary: 'cs-darwin-arm64',
    },
    {
      name: 'a CRLF text',
      content: 'out/test/**\r\ncs-*\r\n*.zip\r\n!cs-linux-arm64/\r\n!cs-linux-arm64/**\r\n.mocharc.json\r\n',
      targetBinary: 'cs-win32-x64',
    },
  ];

  inputs.forEach(({ name, content, targetBinary }) => {
    suite(`applyVscodeIgnoreExceptions for ${name}`, () => {
      let lines: string[];

      setup(() => {
        lines = lineList(packagePlatform.applyVscodeIgnoreExceptions(content, targetBinary));
      });

      test('contains !cs-cwf/ and !cs-cwf/** exactly once, after the cs-* line', () => {
        const csGlob = lines.indexOf('cs-*');
        assert.ok(csGlob >= 0, 'cs-* line present');
        assert.strictEqual(lines.filter(l => l === '!cs-cwf/').length, 1);
        assert.strictEqual(lines.filter(l => l === '!cs-cwf/**').length, 1);
        assert.ok(lines.indexOf('!cs-cwf/') > csGlob);
        assert.ok(lines.indexOf('!cs-cwf/**') > csGlob);
      });

      test('contains the target binary pair exactly once, after the cs-* line', () => {
        const csGlob = lines.indexOf('cs-*');
        assert.strictEqual(lines.filter(l => l === `!${targetBinary}/`).length, 1);
        assert.strictEqual(lines.filter(l => l === `!${targetBinary}/**`).length, 1);
        assert.ok(lines.indexOf(`!${targetBinary}/`) > csGlob);
        assert.ok(lines.indexOf(`!${targetBinary}/**`) > csGlob);
      });

      test('contains no other !cs- line', () => {
        const allowed = ['!cs-cwf/', '!cs-cwf/**', `!${targetBinary}/`, `!${targetBinary}/**`];
        const others = lines.filter(l => l.startsWith('!cs-') && !allowed.includes(l));
        assert.deepStrictEqual(others, []);
      });

      test('keeps every non-!cs- line in its original order', () => {
        const kept = (text: string) => lineList(text).filter(l => !l.startsWith('!cs-'));
        const originalKept = kept(content);
        const resultKept = lines.filter(l => !l.startsWith('!cs-'));
        assert.deepStrictEqual(resultKept.slice(0, originalKept.length), originalKept);
      });
    });
  });

  test('inserts the exceptions directly after the *.zip line when there is one', () => {
    const output = packagePlatform.applyVscodeIgnoreExceptions('cs-*\n*.zip\n\nMakefile\n', 'cs-win32-x64');
    assert.strictEqual(
      output,
      'cs-*\n*.zip\n!cs-cwf/\n!cs-cwf/**\n!cs-win32-x64/\n!cs-win32-x64/**\n\nMakefile\n'
    );
  });

  test('appends the exceptions at the end when there is no *.zip line', () => {
    const output = packagePlatform.applyVscodeIgnoreExceptions('cs-*\nMakefile', 'cs-win32-x64');
    assert.strictEqual(output, 'cs-*\nMakefile\n!cs-cwf/\n!cs-cwf/**\n!cs-win32-x64/\n!cs-win32-x64/**');
  });

  test('is idempotent when applied to its own output', () => {
    const once = packagePlatform.applyVscodeIgnoreExceptions(committedVscodeIgnore, 'cs-linux-x64');
    const twice = packagePlatform.applyVscodeIgnoreExceptions(once, 'cs-linux-x64');
    assert.strictEqual(twice, once);
  });

  test('preserves CRLF line endings without introducing bare LF lines', () => {
    const output: string = packagePlatform.applyVscodeIgnoreExceptions('cs-*\r\n*.zip\r\nMakefile\r\n', 'cs-win32-x64');
    assert.ok(!/(^|[^\r])\n/.test(output));
  });
});
