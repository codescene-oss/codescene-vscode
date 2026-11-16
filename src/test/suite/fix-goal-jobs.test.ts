import * as assert from 'assert';
import * as path from 'path';
import { FixGoalJobs } from '../../objectives/fix-goal-jobs';

suite('FixGoalJobs', () => {
  const file = path.join('/repo', 'src', 'a.ts');
  let jobs: FixGoalJobs;
  let changes: number;

  setup(() => {
    jobs = new FixGoalJobs();
    changes = 0;
    jobs.onDidChange(() => changes++);
  });

  teardown(() => jobs.dispose());

  test('an added job is listed as a running fixGoal job', () => {
    assert.strictEqual(jobs.add(3, file), true);
    assert.deepStrictEqual(jobs.jobs, [{ type: 'fixGoal', goalId: 3, state: 'running', file: { fileName: file } }]);
    assert.strictEqual(changes, 1);
  });

  const duplicates = [
    { name: 'the same path', fileName: file },
    { name: 'an unnormalised path', fileName: path.join('/repo', 'src', '..', 'src', 'a.ts') },
  ];
  for (const { name, fileName } of duplicates) {
    test(`a second add for the same goal and ${name} is refused`, () => {
      jobs.add(3, file);
      assert.strictEqual(jobs.add(3, fileName), false);
      assert.strictEqual(jobs.jobs.length, 1);
      assert.strictEqual(changes, 1);
    });
  }

  test('jobs for another goal or another file are kept apart', () => {
    const other = path.join('/repo', 'src', 'b.ts');
    jobs.add(3, file);
    jobs.add(4, file);
    jobs.add(3, other);
    jobs.remove(3, file);
    assert.deepStrictEqual(
      jobs.jobs.map((job) => [job.goalId, job.file.fileName]),
      [
        [4, file],
        [3, other],
      ]
    );
  });

  test('has reports whether a job exists', () => {
    jobs.add(3, file);
    assert.strictEqual(jobs.has(3, file), true);
    assert.strictEqual(jobs.has(4, file), false);
  });

  test('removing a job fires a change, removing a missing job does not', () => {
    jobs.add(3, file);
    jobs.remove(3, file);
    jobs.remove(3, file);
    assert.deepStrictEqual(jobs.jobs, []);
    assert.strictEqual(changes, 2);
  });

  test('clear removes every job', () => {
    jobs.add(3, file);
    jobs.add(4, file);
    jobs.clear();
    assert.deepStrictEqual(jobs.jobs, []);
  });
});
