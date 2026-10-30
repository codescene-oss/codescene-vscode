import * as assert from 'assert';
import * as vscode from 'vscode';
import { ensureSavedForRefactoring, SAVE_AND_REFACTOR } from '../../refactoring/unsaved-changes';

suite('ensureSavedForRefactoring', () => {
  const originalWarning = vscode.window.showWarningMessage;
  let prompts: Array<{ message: string; options: unknown; items: unknown[] }>;

  function stubPrompt(answer: string | undefined) {
    (vscode.window as any).showWarningMessage = async (message: string, options: unknown, ...items: unknown[]) => {
      prompts.push({ message, options, items });
      return answer;
    };
  }

  setup(() => {
    prompts = [];
  });

  teardown(() => {
    (vscode.window as any).showWarningMessage = originalWarning;
  });

  const cases = [
    { name: 'a saved document proceeds without prompting', isDirty: false, answer: undefined, saveResult: true, expected: true, prompted: false, saved: false },
    { name: 'a dirty document is saved when the user accepts', isDirty: true, answer: SAVE_AND_REFACTOR, saveResult: true, expected: true, prompted: true, saved: true },
    { name: 'a dirty document is left alone when the user dismisses', isDirty: true, answer: undefined, saveResult: true, expected: false, prompted: true, saved: false },
    { name: 'a failed save cancels the refactoring', isDirty: true, answer: SAVE_AND_REFACTOR, saveResult: false, expected: false, prompted: true, saved: true },
  ];

  for (const tc of cases) {
    test(tc.name, async () => {
      stubPrompt(tc.answer);
      let saveCalls = 0;
      const document = {
        isDirty: tc.isDirty,
        fileName: '/repo/CSharp/PrimitiveObsessionExample.cs',
        save: async () => {
          saveCalls++;
          return tc.saveResult;
        },
      } as unknown as vscode.TextDocument;

      const proceed = await ensureSavedForRefactoring(document);

      assert.strictEqual(proceed, tc.expected);
      assert.strictEqual(prompts.length > 0, tc.prompted);
      assert.strictEqual(saveCalls > 0, tc.saved);
      if (tc.prompted) {
        assert.match(prompts[0].message, /PrimitiveObsessionExample\.cs/);
        assert.deepStrictEqual(prompts[0].options, { modal: true });
        assert.deepStrictEqual(prompts[0].items, [SAVE_AND_REFACTOR]);
      }
    });
  }
});
