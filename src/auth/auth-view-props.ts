import { devmode, featureFlags, ideType } from '../centralized-webview-framework/cwf-html-utils';
import type { AuthContextViewProps } from '../centralized-webview-framework/types';

export function authViewProps(): AuthContextViewProps {
  return { ideType, view: 'auth', devmode, pro: true, featureFlags: [...featureFlags] };
}
