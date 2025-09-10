import { FeatureFlags } from "./cwf-feature";
import {
  DeltaForFile,
  FunctionInfo,
  FunctionInfoExternal,
} from "./delta";

import { CommitBaselineType } from "./messages";
export type IdeTypes =  "VSCode"

//View Props
export type AutoRefactorConfig = {
  /** Should we show the refactor feature */
  visible: boolean;
  /** if we show the feature should the button be disabled */
  disabled?: boolean;
  /** if user has approve the use of ACE*/
  activated?: boolean;
};

export type FileDeltaData = {
  file: { fileName: string; fn?: FunctionInfo };
  delta: DeltaForFile;
};

export type Job = {
  file: FileMetaType;
  type: "deltaAnalysis" | "autoRefactor";
  state: "running" | "queued";
};

export interface HomeContextViewProps {
  /**The IDE invoking th webview */
  ideType: IdeTypes;
  /**Enable premium UI elements */
  pro?: boolean;
  /**What view should be rendered */
  view: "home";
  /**devmode will display devtools and log state and messages in the browser console */
  devmode?: boolean;
  /** array of feature flags string */
  featureFlags?: FeatureFlags[];
  data: {
    showOnboarding?: boolean;
    fileDeltaData: FileDeltaData[];
    commitBaseline?: CommitBaselineType;
    autoRefactor?: AutoRefactorConfig;
    /**jobs allows the UI to act on running och queued native jobs such as runnign deltaAnalysis or autoRefacotr */
    jobs?: Job[];
    user?: { name: string } | undefined | null;
  };
}


export type LoginFlowStateType = {
    loginOpen: boolean;
    loginState: LoginViewProps['data']['state'];
  };

export interface LoginViewProps {
  ideType: IdeTypes;
  /**Enable premium UI elements */
  pro?: boolean;
  view: "login";
  /**devmode will display devtools and log state and messages in the browser console */
  devmode?: boolean;
  /** array of feature flags string */
  featureFlags?: FeatureFlags[];
  data: {
    state: "init" | "pending" | "project-selection" | "summary" | "error";
    baseUrl: string;
    repo?: {
      name: string;
    };
    user?: { name: string } | undefined | null;
    availableProjects: {
      name: string;
      id: number;
    }[];
    selectedProjectId?: number;
    errorMessage?: string;
  };
}

export interface DocsContextViewProps {
  /**The IDE invoking th webview */
  ideType: IdeTypes;
  /**Enable premium UI elements */
  pro?: boolean;
  /**What view should be rendered */
  view: 'docs';
  /**devmode will display devtools and log state and messages in the browser console */
  devmode?: boolean;
  /** array of feature flags string */
  featureFlags?: FeatureFlags[];
  data: {
    /**Information about the source file and function  */
    fileData?: FileMetaType;
    /**Which documentation should be rendered */
    docType: string | string[]
    autoRefactor?: AutoRefactorConfig;
  };
}

export type WebViewPropsType = HomeContextViewProps | LoginViewProps | DocsContextViewProps;


export type IdeContextType = WebViewPropsType;

export interface FileMetaType {
  fileName: string;
  fn?: FunctionInfoExternal;
}



