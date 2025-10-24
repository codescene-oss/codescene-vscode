import { HomeContextViewProps, IdeContextType, LoginViewProps } from '../../centralized-webview-framework/types';
import { devmode, featureFlags, ideType } from '../../centralized-webview-framework/cwf-html-utils';

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
  commitBaseline,
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
      commitBaseline,
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
