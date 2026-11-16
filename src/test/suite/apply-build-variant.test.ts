import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { applyNoAceVariant } = require('../../../scripts/apply-build-variant');

const projectPackageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../..', 'package.json'), 'utf8'));

const AGENT_SETTINGS = [
  'codescene.enableAutoRefactor',
  'codescene.authToken',
  'codescene.agentModel',
  'codescene.agentModelOverride',
  'codescene.providerOptions',
];
const AGENT_COMMANDS = ['codescene.testConnectivity', 'codescene.setProviderApiKey'];

suite('Apply build variant Test Suite', () => {
  let projectRoot: string;

  setup(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-build-variant-'));
    fs.writeFileSync(path.join(projectRoot, 'package.json'), JSON.stringify(projectPackageJson));
  });

  teardown(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  test('the no-ACE variant keeps its own package name', () => {
    const pkg = applyNoAceVariant(projectRoot);
    assert.deepStrictEqual({ name: pkg.name, version: pkg.version }, { name: 'codescene-vscode-noace', version: projectPackageJson.version });
  });

  test('the no-ACE variant has no agent settings', () => {
    const pkg = applyNoAceVariant(projectRoot);
    const properties = Object.keys(pkg.contributes.configuration.properties);
    assert.deepStrictEqual(AGENT_SETTINGS.filter((key) => properties.includes(key)), []);
  });

  test('the no-ACE variant has no agent commands or menu entries', () => {
    const pkg = applyNoAceVariant(projectRoot);
    const contributed = [
      ...pkg.contributes.commands.map((c: { command: string }) => c.command),
      ...pkg.contributes.menus.commandPalette.map((c: { command: string }) => c.command),
    ];
    assert.deepStrictEqual(AGENT_COMMANDS.filter((command) => contributed.includes(command)), []);
  });

  test('the no-ACE variant keeps the other commands', () => {
    const pkg = applyNoAceVariant(projectRoot);
    assert.strictEqual(
      pkg.contributes.commands.length,
      projectPackageJson.contributes.commands.length - AGENT_COMMANDS.length
    );
  });
});
