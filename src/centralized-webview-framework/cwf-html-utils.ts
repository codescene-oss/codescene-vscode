import { Webview } from 'vscode';
import { IdeContextType } from './types';
import { getUri } from '../webview-utils';
import { FeatureFlags } from './types/cwf-feature';
export const ideType = 'VSCode';

// This flag is used to enable or disable the login flow
// true: will ignore any session data and always show Code Health Monitor
// false: will respect any session and display sign in buttons, only showing Code Health Monitor if you are signed in.
export const ignoreSessionStateFeatureFlag = true;

// Enable Webview devmode with alot of logging
export const devmode = false;
export const featureFlags: FeatureFlags[] = ['jobs', 'open-settings']; // CS-5597: removed 'commit-baseline'
if (!ignoreSessionStateFeatureFlag) featureFlags.push('sign-in');

const opacityHexLookup = {
  '1': {
    hex: '03',
  },
  '3': {
    hex: '08',
  },
  '7': {
    hex: '12',
  },
  '10': {
    hex: '1A',
  },
  '20': {
    hex: '33',
  },
  '30': {
    hex: '4D',
  },
  '40': {
    hex: '66',
  },
  '50': {
    hex: '80',
  },
  '60': {
    hex: '99',
  },
  '70': {
    hex: 'B3',
  },
  '75': {
    hex: 'BF',
  },
  '80': {
    hex: 'CC',
  },
  '85': {
    hex: 'D9',
  },
  '90': {
    hex: 'E6',
  },
};

export const ideStylesVars = `
  <style>
    :root {
      --cs-theme-editor-background: var(--vscode-editor-background);
      --cs-theme-editor-foreground: var(--vscode-editor-foreground);
      --cs-theme-textLink-foreground: var(--vscode-textLink-foreground);
      --cs-theme-scroll-bar-thumb: var(--vscode-scrollbarSlider-background);

      --cs-theme-foreground: var(--vscode-foreground);
      ${Object.keys(opacityHexLookup)
        .map(
          (opacity) =>
            `--cs-theme-foreground-${opacity}: color-mix(in srgb, var(--vscode-foreground) ${opacity}%, transparent);`
        )
        .join('\n      ')}

      --cs-theme-panel-background: var(--vscode-panel-background);
      --cs-theme-textCodeBlock-background: var(--vscode-textCodeBlock-background);
      --cs-theme-font-family: var(--vscode-font-family);
      --cs-theme-font-size: var(--vscode-font-size);
      --cs-theme-editor-font-family: var(--vscode-editor-font-family);
      --cs-theme-editor-font-size: var(--vscode-editor-font-size);

      --cs-theme-button-foreground: var(--vscode-button-foreground);
      ${Object.keys(opacityHexLookup)
        .map(
          (opacity) =>
            `--cs-theme-button-foreground-${opacity}: color-mix(in srgb, var(--vscode-button-foreground) ${opacity}%, transparent);`
        )
        .join('\n      ')}

      --cs-theme-button-background: var(--vscode-button-background);
      ${Object.keys(opacityHexLookup)
        .map(
          (opacity) =>
            `--cs-theme-button-background-${opacity}: color-mix(in srgb, var(--vscode-button-background) ${opacity}%, transparent);`
        )
        .join('\n      ')}
      --cs-theme-button-secondaryForeground: var(--vscode-button-secondaryForeground);

      --cs-theme-button-secondaryBackground: var(--vscode-button-secondaryBackground);
      ${Object.keys(opacityHexLookup)
        .map(
          (opacity) =>
            `--cs-theme-button-secondaryBackground-${opacity}: color-mix(in srgb, var(--vscode-button-secondaryBackground) ${opacity}%, transparent);`
        )
        .join('\n      ')}
    }
  </style>
`;

export const initialDataContextScriptTag = (ideContext: IdeContextType) => /*html*/ `
  <script>
    function setContext() {
      window.ideContext = ${JSON.stringify(ideContext)}
    }
    setContext();
  </script>
`;

export const generateContextScriptTag = (ideContext: IdeContextType) => {
  return `
  <script>
    function setContext() {
      window.ideContext = ${JSON.stringify(ideContext)}
    }
    setContext();
  </script>`;
};

export const getCsp = (webview: Webview) => [
  `default-src 'none';`,
  `script-src ${webview.cspSource} 'unsafe-eval' 'unsafe-inline' https://* `,
  `style-src ${webview.cspSource} 'self' 'unsafe-inline' https://*`,
  `img-src ${webview.cspSource} 'self' data: 'unsafe-inline' https://*`,
  `font-src ${webview.cspSource}`,
  `connect-src https://*`,
];

export function initBaseContent(webView: Webview, initialIdeContext: IdeContextType) {
  const scriptUri = getUri(webView, 'cs-cwf', 'assets', 'index.js');
  const stylesUri = getUri(webView, 'cs-cwf', 'assets', 'index.css');
  const csp = getCsp(webView);

  // The full html with all previous varaibles included
  return /*html*/ `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta http-equiv="Content-Security-Policy" content="${csp.join('; ')}">
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" type="text/css" href="${stylesUri}">
      <title>VSCode React Webview</title>
      ${ideStylesVars}
      ${initialDataContextScriptTag(initialIdeContext)}
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="${scriptUri}"></script>
    </body>
  </html>`;
}
