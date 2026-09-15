import { HomeContextViewProps, IdeContextType, Job, LoginViewProps } from '../../centralized-webview-framework/types';
import { devmode, featureFlags, ideType } from '../../centralized-webview-framework/cwf-html-utils';
import { normalizeFsPath } from '../../utils/fs-paths';

export function analysisJobsToCwf(running?: Iterable<string>, queued?: string[]): Job[] {
  const runningList = running ? [...running] : [];
  const runningKeys = new Set(runningList.map(normalizeFsPath));
  const jobs: Job[] = runningList.map((fileName) => ({
    file: { fileName },
    type: 'deltaAnalysis',
    state: 'running',
  }));
  for (const fileName of queued ?? []) {
    if (runningKeys.has(normalizeFsPath(fileName))) continue;
    jobs.push({
      file: { fileName },
      type: 'deltaAnalysis',
      state: 'queued',
    });
  }
  return jobs;
}

/**
 * Generate all needed props for CWF HomeView
 * @param param0
 * @returns
 */
export const getHomeData = ({
  fileDeltaData,
  jobs,
  autoRefactor,
  showOnboarding,
  signedIn,
  user,
}: HomeContextViewProps['data'] & { signedIn: boolean }): IdeContextType => {
  return {
    ideType: ideType,
    view: 'home',
    devmode: devmode,
    pro: signedIn,
    featureFlags: featureFlags,
    data: {
      fileDeltaData,
      jobs,
      autoRefactor,
      showOnboarding,
      user,
    },
  };
};

/**
 * Generate all needed props for LoginView
 * @param param0
 * @returns
 */
export const getLoginData = ({ baseUrl, state, availableProjects, user }: LoginViewProps['data']) => {
  return {
    ideType: ideType,
    view: 'login',
    devmode: devmode,
    pro: false,
    featureFlags: featureFlags,
    data: {
      baseUrl,
      state,
      availableProjects,
      user,
    },
  };
};
