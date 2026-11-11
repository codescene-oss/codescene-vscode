import * as assert from 'assert';
import type { IdeContextType, ObjectivesField } from '../../centralized-webview-framework/types';
import { getHomeData } from '../../code-health-monitor/home/home-props-utils';
import { setCwfObjectives } from '../../objectives/cwf-objectives';
import { fixture } from '../contract/contract';

const homeData = { fileDeltaData: [], jobs: [], analysisState: 'idle' as const };

function homePayload(): IdeContextType & ObjectivesField {
  return getHomeData(homeData) as IdeContextType & ObjectivesField;
}

suite('Home payload objectives', () => {
  teardown(() => setCwfObjectives(undefined));

  test('has no objectives field and no flag while there is no snapshot', () => {
    const payload = homePayload();
    assert.deepStrictEqual(
      { objectives: payload.objectives, flagged: payload.featureFlags?.includes('ide-objectives') },
      { objectives: undefined, flagged: false }
    );
  });

  test('carries the snapshot and adds the ide-objectives flag without touching the shared flags', () => {
    const snapshot = fixture('objectives-snapshot', 'full', 'entity');
    setCwfObjectives(snapshot);
    const payload = homePayload();
    setCwfObjectives(undefined);
    assert.deepStrictEqual(
      { objectives: payload.objectives, flagged: payload.featureFlags?.includes('ide-objectives'), later: homePayload().featureFlags?.includes('ide-objectives') },
      { objectives: snapshot, flagged: true, later: false }
    );
  });

  test('adds goal-work-sessions flag when work sessions capability is enabled', () => {
    const snapshot = fixture('objectives-snapshot', 'full', 'entity');
    setCwfObjectives(snapshot, { workSessions: true });
    const payload = homePayload();
    assert.deepStrictEqual(
      {
        objectivesFlag: payload.featureFlags?.includes('ide-objectives'),
        workSessionsFlag: payload.featureFlags?.includes('goal-work-sessions'),
      },
      { objectivesFlag: true, workSessionsFlag: true }
    );
  });

  test('omits goal-work-sessions flag when work sessions capability is not enabled', () => {
    const snapshot = fixture('objectives-snapshot', 'full', 'entity');
    setCwfObjectives(snapshot, { workSessions: false });
    const payload = homePayload();
    assert.deepStrictEqual(
      {
        objectivesFlag: payload.featureFlags?.includes('ide-objectives'),
        workSessionsFlag: payload.featureFlags?.includes('goal-work-sessions'),
      },
      { objectivesFlag: true, workSessionsFlag: false }
    );
  });
});
