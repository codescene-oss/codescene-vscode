import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { DevtoolsAPI } from '../../devtools-api';
import { mockWorkspaceFolders, createMockWorkspaceFolder, restoreDefaultWorkspaceFolders } from '../setup';
import { createMockExtensionContext } from '../mocks/mock-extension-context';
import { createTestDir, ensureBinary } from '../integration_helper';

suite('Code Health Rules Template Test Suite', () => {
  const testDir = createTestDir('test-code-health-rules-template');

  async function getTemplate(): Promise<string> {
    return await DevtoolsAPI.codeHealthRulesTemplate();
  }

  async function getParsedTemplate(): Promise<any> {
    const template = await getTemplate();
    return JSON.parse(template);
  }

  setup(async function() {
    this.timeout(60000);
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    mockWorkspaceFolders([createMockWorkspaceFolder(testDir)]);

    const binaryPath = await ensureBinary();
    const mockContext = createMockExtensionContext(testDir);

    DevtoolsAPI.init(binaryPath, mockContext);
  });

  teardown(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    restoreDefaultWorkspaceFolders();
  });

  test('codeHealthRulesTemplate returns valid template', async function() {
    this.timeout(10000);

    const template = await getTemplate();

    assert.ok(template, 'Template should not be empty');
    assert.ok(typeof template === 'string', 'Template should be a string');
    assert.ok(template.length > 0, 'Template should have content');
  });

  test('codeHealthRulesTemplate returns parseable JSON', async function() {
    this.timeout(10000);

    const template = await getTemplate();

    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(template);
    }, 'Template should be valid JSON');

    assert.ok(parsed, 'Parsed template should exist');
  });

  test('codeHealthRulesTemplate contains expected structure', async function() {
    this.timeout(10000);

    const parsed = await getParsedTemplate();

    assert.ok(parsed, 'Parsed template should be an object');
    assert.ok(typeof parsed === 'object', 'Template should parse to an object');
    assert.ok('usage' in parsed, 'Template should have a usage field');
    assert.ok('rule_sets' in parsed, 'Template should have a rule_sets field');
    assert.ok(Array.isArray(parsed.rule_sets), 'rule_sets should be an array');
    assert.ok(parsed.rule_sets.length > 0, 'rule_sets should not be empty');
  });

  test('codeHealthRulesTemplate rule sets contain thresholds', async function() {
    this.timeout(10000);

    const parsed = await getParsedTemplate();
    const firstRuleSet = parsed.rule_sets[0];

    assert.ok(firstRuleSet, 'First rule set should exist');
    assert.ok('thresholds' in firstRuleSet, 'Rule set should have thresholds');
    assert.ok(Array.isArray(firstRuleSet.thresholds), 'thresholds should be an array');
    assert.ok(firstRuleSet.thresholds.length > 0, 'thresholds should not be empty');

    const firstThreshold = firstRuleSet.thresholds[0];
    assert.ok('name' in firstThreshold, 'Threshold should have a name field');
    assert.ok('value' in firstThreshold, 'Threshold should have a value field');
  });
});
