import { CachingReviewer } from '../../review/caching-reviewer';
import { TestTextDocument } from '../mocks/test-text-document';
import { assertLogContains } from '../setup';

suite('CachingReviewer', () => {
  test('reports a rejected review', async () => {
    const reviewer = new CachingReviewer(() => new Map());
    const filteringReviewer = (reviewer as any).reviewer;
    filteringReviewer.dispose();
    (reviewer as any).reviewer = {
      review: async () => {
        throw new Error('review failed');
      },
      dispose: () => {},
    };

    const document = new TestTextDocument('/test/file.ts', 'const value = 1;', 'typescript');
    const review = reviewer.review(document, { skipMonitorUpdate: true, updateDiagnosticsPane: false });
    await review.reviewResult;

    assertLogContains('error', 'Review error');
    assertLogContains('error', 'review failed');
    reviewer.dispose();
  });
});
