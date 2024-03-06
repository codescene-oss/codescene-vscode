import * as assert from 'assert';
import { PreFlightResponse } from '../../cs-rest-api';
import { aceEnabled, codeHealthAnalysisEnabled } from '../../webviews/status-view-provider';

suite('Status view provider test suite', () => {
  test('Code health enabled/disabled', () => {
    assert.strictEqual(codeHealthAnalysisEnabled(), false);
    assert.strictEqual(codeHealthAnalysisEnabled({}), false);
    assert.strictEqual(codeHealthAnalysisEnabled({ codeHealthAnalysis: { error: 'Error verifying CLI' } }), false);

    assert.strictEqual(codeHealthAnalysisEnabled({ codeHealthAnalysis: { cliPath: '/opt/cs' } }), true);
  });

  test('ACE enabled/disabled', () => {
    assert.strictEqual(aceEnabled(), false);
    assert.strictEqual(aceEnabled({ automatedCodeEngineering: 'Loading...' }), false);
    assert.strictEqual(aceEnabled({ automatedCodeEngineering: new Error('Service responded with status 401') }), false);

    const preFlight: PreFlightResponse = {
      'max-input-loc': 1,
      'max-input-tokens': 1,
      supported: {
        'code-smells': [],
        'file-types': [],
      },
    };
    assert.strictEqual(aceEnabled({ automatedCodeEngineering: preFlight }), true);
  });
});
