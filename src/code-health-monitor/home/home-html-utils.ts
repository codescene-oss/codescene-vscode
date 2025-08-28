import { Webview } from 'vscode';
import { getUri } from '../../webview-utils';

const IDE_TYPE = 'VSCode';

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

const deltaData = {
  fileDeltaData: [],
  jobs: [],
  showOnboarding: false,
  autoRefactor: {
    activated: true, // indicate that the user has not approved the use of ACE yet
    disabled: false, // disable the visible button if visible: true
    visible: true, // Show any type of ACE functionality
  },
};

export const initialDataContext = /*html*/ `
  <script>
    function setContext() {
      window.ideContext = {
        ideType: ${IDE_TYPE},
        view: 'home',
        devmode:true,
        pro: true,
        featureFlags: ["jobs", "commit-baseline", "open-settings"],
        data: ${JSON.stringify(deltaData)}
      }
    }
    setContext();
  </script>
`;

export const getHomeData = ({fileDeltaData, jobs, autoRefactor, showOnboarding, commitBaseline}:{
  fileDeltaData: any[],
  jobs: any[],
  autoRefactor: any,
  showOnboarding: boolean,
  commitBaseline: string
}) => {
  return {
    ideType: IDE_TYPE,
    view: 'home',
    devmode: true,
    pro: true,
    featureFlags: ['jobs', 'commit-baseline', 'open-settings'],
    data: {
      fileDeltaData,
      jobs,
      autoRefactor,
      showOnboarding,
      commitBaseline,
    },
  };
};

export const generateContextScriptTag = (ideContext: any) => {
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

export function initBaseContent(webView: Webview) {
  const scriptUri = getUri(webView, 'cs-cwf', 'index.js');
  const stylesUri = getUri(webView, 'cs-cwf', 'index.css');
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
      ${initialDataContext}
    </head>
    <body>
      <div id="root"></div>
      <script type="module" src="${scriptUri}"></script>
    </body>
  </html>`;
}