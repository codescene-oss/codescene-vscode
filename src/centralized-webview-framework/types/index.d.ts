import { RefactorResponse } from './ace';
import { AuthPayload } from './auth';
import { FeatureFlags } from './cwf-feature';
import { DeltaForFile, FunctionInfo, FunctionInfoExternal } from './delta';

export interface AuthField {
  auth?: AuthPayload;
}

export type IdeTypes = 'VSCode';

//View Props
export type AutoRefactorConfig = {
  /** Should we show the refactor feature */
  visible: boolean;
  /** if we show the feature should the button be disabled */
  disabled?: boolean;
  /** if user has approved the use of ACE (ACE acknowledgement) */
  activated?: boolean;
};

export type FileDeltaData = {
  file: { fileName: string; fn?: FunctionInfo };
  delta: DeltaForFile;
};

export type Job = {
  file: FileMetaType;
  type: 'deltaAnalysis' | 'autoRefactor';
  state: 'running' | 'queued';
};

export type AnalysisState = 'idle' | 'running' | 'stopped';

export interface HomeContextViewProps extends AuthField {
  /**The IDE invoking th webview */
  ideType: IdeTypes;
  /**Enable premium UI elements */
  pro?: boolean;
  /**What view should be rendered */
  view: 'home';
  /**devmode will display devtools and log state and messages in the browser console */
  devmode?: boolean;
  /** array of feature flags string */
  featureFlags?: FeatureFlags[];
  data: {
    showOnboarding?: boolean;
    fileDeltaData: FileDeltaData[];
    autoRefactor?: AutoRefactorConfig;
    /**jobs allows the UI to act on running och queued native jobs such as runnign deltaAnalysis or autoRefacotr */
    jobs?: Job[];
    analysisState?: AnalysisState;
    totalCount?: number;
    remainingCount?: number;
    user?: { name: string } | undefined | null;
  };
}

export interface DocsContextViewProps extends AuthField {
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
    docType: string | string[];
    autoRefactor?: AutoRefactorConfig;
  };
}

export interface AceContextViewProps extends AuthField {
  /**The IDE invoking th webview */
  ideType: IdeTypes;
  /**Enable premium UI elements */
  pro?: boolean;
  /**What view should be rendered */
  view: 'ace';
  /**devmode will display devtools and log state and messages in the browser console */
  devmode?: boolean;
  /** array of feature flags string */
  featureFlags?: FeatureFlags[];
  data: {
    fileData: FileMetaType;
    aceResultData?: RefactorResponse;
    error?: string;
    isStale: boolean;
    loading: boolean;
    progressMessage?: string;
  };
}

export interface AceAcknowledgeContextViewProps extends AuthField {
  /**The IDE invoking th webview */
  ideType: IdeTypes;
  /**Enable premium UI elements */
  pro?: boolean;
  /**What view should be rendered */
  view: 'aceAcknowledge';
  /**devmode will display devtools and log state and messages in the browser console */
  devmode?: boolean;
  /** array of feature flags string */
  featureFlags?: FeatureFlags[];
  data: {
    fileData?: FileMetaType;
    autoRefactor: AutoRefactorConfig;
  };
}

export interface AuthContextViewProps extends AuthField {
  ideType: IdeTypes;
  pro?: boolean;
  view: 'auth';
  devmode?: boolean;
  featureFlags?: FeatureFlags[];
  data?: undefined;
}

export type WebViewPropsType =
  | HomeContextViewProps
  | DocsContextViewProps
  | AceContextViewProps
  | AceAcknowledgeContextViewProps
  | AuthContextViewProps;

export type IdeContextType = WebViewPropsType;

export interface FileMetaType {
  fileName: string;
  fn?: FunctionInfoExternal;
}
