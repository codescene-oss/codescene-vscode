import * as assert from 'assert';
import { OpenFilesObserver } from '../../review/open-files-observer';
import { createMockExtensionContext } from '../mocks/mock-extension-context';

suite('OpenFilesObserver Test Suite', () => {
  test('dispose clears poll timer and stops polling', () => {
    const context = createMockExtensionContext('/test/open-files');
    const observer = new OpenFilesObserver(context as any);
    (observer as any).pollTimeoutHandle = setTimeout(() => {}, 10_000);
    observer.dispose();
    assert.strictEqual((observer as any).pollTimeoutHandle, undefined);
    (observer as any).pollForVisibleEditors();
  });
});
