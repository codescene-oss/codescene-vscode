import * as assert from 'assert';
import { PreFlightResponse } from '../../refactoring/model';
import { aceEnabled, codeHealthAnalysisEnabled } from '../../status-view/status-view-provider';

suite('Status view provider test suite', () => {
  test('Code health enabled/disabled', () => {
    assert.strictEqual(codeHealthAnalysisEnabled(), false);
    assert.strictEqual(codeHealthAnalysisEnabled({}), false);
    assert.strictEqual(codeHealthAnalysisEnabled({ codeHealthAnalysis: new Error('Error verifying CLI') }), false);

    assert.strictEqual(codeHealthAnalysisEnabled({ codeHealthAnalysis: '/opt/cs' }), true);
  });

  test('ACE enabled/disabled', () => {
    assert.strictEqual(aceEnabled(), false);
    assert.strictEqual(aceEnabled({ ace: 'Loading...' }), false);
    assert.strictEqual(aceEnabled({ ace: new Error('Service responded with status 401') }), false);

    const preFlight: PreFlightResponse = {
      'max-input-loc': 1,
      'max-input-tokens': 1,
      supported: {
        'code-smells': [],
        'file-types': [],
      },
    };
    assert.strictEqual(aceEnabled({ ace: preFlight }), true);
  });
});
