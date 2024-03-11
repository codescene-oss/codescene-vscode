import * as assert from 'assert';
import { CsRestApi } from '../../cs-rest-api';

suite('Cs Rest Api test', () => {
  test('Get Rest API instance ', () => {
    // Will fail creating an instance if we change the extension id
    assert.ok(CsRestApi.instance);
  });
});
