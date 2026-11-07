import { devmode, featureFlags, ideType } from '../centralized-webview-framework/cwf-html-utils';
import type { AuthContextViewProps } from '../centralized-webview-framework/types';
import { cwfAuthPro } from './cwf-auth';

export function authViewProps(): AuthContextViewProps {
  return { ideType, view: 'auth', devmode, pro: cwfAuthPro(), featureFlags: [...featureFlags] };
}
