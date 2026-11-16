import * as assert from 'assert';
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { AbortError } from '../../devtools-api/abort-error';
import {
  AgentTimeoutError,
  killAllAgentProcesses,
  liveAgentProcessCount,
  trackAgentProcess,
  waitForExit,
} from '../../refactoring/agent-process';

function fakeProcess(): ChildProcess {
  const proc = new EventEmitter() as any;
  proc.pid = undefined;
  proc.exitCode = null;
  proc.kill = () => true;
  return proc;
}

suite('agent process', () => {
  teardown(() => killAllAgentProcesses());

  test('waitForExit resolves with the exit code', async () => {
    const proc = fakeProcess();
    const exit = waitForExit(proc, { timeoutMs: 1000 });
    proc.emit('close', 3);
    assert.strictEqual(await exit, 3);
  });

  const rejectionCases = [
    {
      name: 'rejects with AbortError when aborted while running',
      run: (proc: ChildProcess, controller: AbortController) => {
        const exit = waitForExit(proc, { signal: controller.signal, timeoutMs: 1000 });
        controller.abort();
        return exit;
      },
      expected: AbortError,
    },
    {
      name: 'rejects with AbortError when already aborted',
      run: (proc: ChildProcess, controller: AbortController) => {
        controller.abort();
        return waitForExit(proc, { signal: controller.signal, timeoutMs: 1000 });
      },
      expected: AbortError,
    },
    {
      name: 'rejects with AgentTimeoutError when the agent runs too long',
      run: (proc: ChildProcess, controller: AbortController) => waitForExit(proc, { signal: controller.signal, timeoutMs: 5 }),
      expected: AgentTimeoutError,
    },
  ];

  for (const { name, run, expected } of rejectionCases) {
    test(`waitForExit ${name}`, async () => {
      await assert.rejects(run(fakeProcess(), new AbortController()), expected);
    });
  }

  test('killAllAgentProcesses stops a tracked process', async function () {
    this.timeout(10000);
    const proc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: process.platform !== 'win32',
      stdio: 'ignore',
    });
    trackAgentProcess(proc);
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    await new Promise((resolve) => proc.once('spawn', resolve));
    assert.strictEqual(liveAgentProcessCount(), 1);

    killAllAgentProcesses();

    await exited;
    assert.strictEqual(liveAgentProcessCount(), 0);
  });
});
