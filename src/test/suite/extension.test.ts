import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', function () {
  void vscode.window.showInformationMessage('Start all tests.');
  this.timeout(10000);

  suiteSetup(async function () {
    await vscode.extensions.getExtension('codescene.codescene-vscode')?.activate();
  });

  test('Extension is active', () => {
    assert.ok(vscode.extensions.getExtension('codescene.codescene-vscode')?.isActive);
  });

  test('Diagnostics are registered', async () => {
    const emptyDiags = vscode.languages.getDiagnostics();

    // It should be empty because we haven't opened any files yet.
    assert.strictEqual(emptyDiags.length, 0);

    // I wanted to try to open a file and see that the diagnostics are
    // registered, but I couldn't get it to work. TBD.
  });
});
