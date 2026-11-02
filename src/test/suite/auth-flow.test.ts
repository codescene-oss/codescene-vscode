import * as assert from 'assert';
import { IDLE_FLOW, nextStep, type FlowState } from '../../auth/auth-flow';
import { INACTIVE_SNAPSHOT, type AuthSnapshot } from '../../auth/auth-payload';
import type { Account, Project } from '../../centralized-webview-framework/types/auth';
import { authStatusFixture } from '../fixtures/auth/auth-fixtures';

const accountA: Account = { id: 'a', name: 'Account A', 'signed-in-locally': true };
const accountB: Account = { id: 'b', name: 'Account B', 'signed-in-locally': false };
const project: Project = { id: 'p1', name: 'Project One' };
const repo = { path: '/work/repo', name: 'repo' };

const signedIn: AuthSnapshot = {
  ...INACTIVE_SNAPSHOT,
  active: true,
  status: authStatusFixture('signed-in-oauth'),
};

const signInFlow: FlowState = { ...IDLE_FLOW, kind: 'sign-in', resolved: true };

suite('Auth flow step rules', () => {
  const cases: { name: string; flow: FlowState; snapshot: Partial<AuthSnapshot>; expected: string }[] = [
    { name: 'idle shows the summary', flow: IDLE_FLOW, snapshot: {}, expected: 'summary' },
    {
      name: 'sign-in not yet resolved is resolving',
      flow: { ...signInFlow, resolved: false },
      snapshot: {},
      expected: 'resolving',
    },
    {
      name: 'two accounts, no linked project, not chosen picks account',
      flow: signInFlow,
      snapshot: { accounts: [accountA, accountB], repo, projects: [project] },
      expected: 'pick-account',
    },
    {
      name: 'two accounts with a linked project skips the account step',
      flow: signInFlow,
      snapshot: { accounts: [accountA, accountB], repo, projects: [project], linkedProject: project },
      expected: 'done',
    },
    {
      name: 'two accounts, account chosen, no linked project picks project',
      flow: { ...signInFlow, accountChosen: true },
      snapshot: { accounts: [accountA, accountB], repo, projects: [project] },
      expected: 'pick-project',
    },
    {
      name: 'one account, no linked project picks project',
      flow: signInFlow,
      snapshot: { accounts: [accountA], repo, projects: [project] },
      expected: 'pick-project',
    },
    {
      name: 'null accounts, no linked project picks project',
      flow: signInFlow,
      snapshot: { accounts: null, repo, projects: [project] },
      expected: 'pick-project',
    },
    {
      name: 'project skipped is done',
      flow: { ...signInFlow, projectSkipped: true },
      snapshot: { accounts: [accountA], repo, projects: [project] },
      expected: 'done',
    },
    {
      name: 'no repo is done',
      flow: signInFlow,
      snapshot: { accounts: [accountA], repo: null, projects: [project] },
      expected: 'done',
    },
    {
      name: 'null projects is done',
      flow: signInFlow,
      snapshot: { accounts: [accountA], repo, projects: null },
      expected: 'done',
    },
    {
      name: 'empty projects is done',
      flow: signInFlow,
      snapshot: { accounts: [accountA], repo, projects: [] },
      expected: 'done',
    },
    {
      name: 'linked project is done',
      flow: signInFlow,
      snapshot: { accounts: [accountA], repo, projects: [project], linkedProject: project },
      expected: 'done',
    },
    {
      name: 'manual-account picks account',
      flow: { ...IDLE_FLOW, kind: 'manual-account' },
      snapshot: { accounts: [accountA, accountB] },
      expected: 'pick-account',
    },
    {
      name: 'manual-account with account chosen is done',
      flow: { ...IDLE_FLOW, kind: 'manual-account', accountChosen: true },
      snapshot: { accounts: [accountA, accountB] },
      expected: 'done',
    },
    {
      name: 'manual-project picks project',
      flow: { ...IDLE_FLOW, kind: 'manual-project' },
      snapshot: { repo, projects: [project] },
      expected: 'pick-project',
    },
    {
      name: 'sign-in while signing in shows the summary',
      flow: { ...signInFlow, resolved: false },
      snapshot: { status: authStatusFixture('signing-in') },
      expected: 'summary',
    },
    {
      name: 'sign-in while signed out shows the summary',
      flow: { ...signInFlow, resolved: false },
      snapshot: { status: authStatusFixture('signed-out') },
      expected: 'summary',
    },
  ];

  cases.forEach(({ name, flow, snapshot, expected }) => {
    test(name, () => {
      assert.strictEqual(nextStep(flow, { ...signedIn, ...snapshot }), expected);
    });
  });
});
