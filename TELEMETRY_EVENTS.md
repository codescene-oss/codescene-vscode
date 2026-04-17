# CodeScene VS Code Extension - Telemetry Events Summary

This document provides a comprehensive overview of all telemetry events sent to the CLI from the CodeScene VS Code extension.

## Event Infrastructure

All telemetry events are sent through the `Telemetry` class (src/telemetry.ts) and posted to the DevtoolsAPI. Each event includes the following standard fields:
- `event-name`: The name of the event
- `event-time`: ISO timestamp when the event occurred
- `editor-type`: Always "vscode"
- `extension-version`: Version of the CodeScene extension
- `process-platform`: Platform OS (e.g., win32, darwin, linux)
- `process-arch`: Process architecture (e.g., x64, arm64)
- `user-id`: CodeScene user account ID (if authenticated)
- `internal`: Set to true for internal CodeScene usage (when X_CODESCENE_INTERNAL env var is set)

## Telemetry Events

### 1. Extension Lifecycle Events

#### `on_activate_extension`
- **Source**: src/extension-impl.ts:197
- **Event Data**: None
- **Purpose**: Tracks successful extension activation. Provides basic usage statistics for the extension.

#### `on_activate_extension_error`
- **Source**: src/extension-impl.ts:127
- **Event Data**:
  - `errorMessage` (string): The error message from the activation failure
- **Purpose**: Tracks extension activation failures to help diagnose startup issues.

---

### 2. Authentication Events

#### `auth/attempted`
- **Source**: src/auth/auth-provider.ts:143
- **Event Data**: None
- **Purpose**: Tracks when a user initiates the authentication flow by clicking sign-in.

#### `auth/cancelled`
- **Source**: src/auth/auth-provider.ts:162, 171
- **Event Data**: None
- **Purpose**: Tracks when users cancel the authentication process, either by clicking the cancel button or by timeout/starting another login attempt.

#### `auth/rejected`
- **Source**: src/auth/auth-provider.ts:206, 212, 218
- **Event Data**: None
- **Purpose**: Tracks when authentication fails due to missing required data (token, name, or user-id) in the OAuth redirect.

#### `auth/successful`
- **Source**: src/auth/auth-provider.ts:223
- **Event Data**: None
- **Purpose**: Tracks successful authentication completions.

---

### 3. ACE (AI Code Enhancement) Refactoring Events

#### `ace-info/presented`
- **Source**: src/refactoring/commands.ts:44
- **Event Data**:
  - `source` (string): Where the ACE info was triggered from (e.g., "diagnostic-item", "code-lens")
- **Purpose**: Tracks when the ACE acknowledgement/info panel is shown to users who haven't yet acknowledged ACE usage (first-time experience).

#### `ace-info/acknowledged`
- **Source**:
  - src/codescene-tab/webview-panel.ts:133
  - src/codescene-tab/webview/ace/acknowledgement/cwf-webview-ace-acknowledgement-panel.ts:82
- **Event Data**: None
- **Purpose**: Tracks when users acknowledge the ACE usage terms and information.

#### `refactor/requested`
- **Source**: src/refactoring/commands.ts:50
- **Event Data**:
  - `source` (string): Where the refactoring was requested from (e.g., "code-lens", "command-palette", "diagnostic-item")
  - `traceId` (string): UUID for tracking the refactoring request
  - `skipCache` (boolean, optional): Whether cache was bypassed for this request
- **Purpose**: Tracks when a user requests ACE to refactor a function.

#### `refactor/presented`
- **Source**:
  - src/codescene-tab/webview-panel.ts:335
  - src/codescene-tab/webview-panel.ts:367
- **Event Data**:
  - `confidence` (string | number): Confidence level of the refactoring (0-100) or "error" if failed
  - `isCached` (boolean): Whether the refactoring result was served from cache
  - `traceId` (string): UUID for tracking the refactoring request
  - `skipCache` (boolean, optional): Whether cache was bypassed
- **Purpose**: Tracks when refactoring results are displayed to the user, including success and failure cases.

#### `refactor/applied`
- **Source**: src/refactoring/commands.ts:70
- **Event Data**:
  - `traceId` (string): UUID for tracking the refactoring request
  - `skipCache` (boolean, optional): Whether cache was bypassed
- **Purpose**: Tracks when a user accepts and applies a refactoring to their code.

#### `refactor/rejected`
- **Source**:
  - src/codescene-tab/webview-panel.ts:164
  - src/codescene-tab/webview/ace/cwf-webview-ace-panel.ts:118
- **Event Data**:
  - `traceId` (string): UUID for tracking the refactoring request
  - `skipCache` (boolean, optional): Whether cache was bypassed
- **Purpose**: Tracks when a user rejects/declines a proposed refactoring.

#### `refactor/copy-code`
- **Source**:
  - src/codescene-tab/webview-panel.ts:177
  - src/codescene-tab/webview/ace/cwf-webview-ace-panel.ts:144
- **Event Data**:
  - `traceId` (string): UUID for tracking the refactoring request
  - `skipCache` (boolean, optional): Whether cache was bypassed
- **Purpose**: Tracks when a user copies the refactored code to clipboard.

#### `refactor/copy-declarations`
- **Source**: src/codescene-tab/webview-panel.ts:181
- **Event Data**:
  - `traceId` (string): UUID for tracking the refactoring request
  - `skipCache` (boolean, optional): Whether cache was bypassed
- **Purpose**: Tracks when a user copies the refactored declarations/dependencies to clipboard.

#### `refactor/diff-shown`
- **Source**: src/refactoring/commands.ts:121
- **Event Data**:
  - `traceId` (string): UUID for tracking the refactoring request
  - `skipCache` (boolean, optional): Whether cache was bypassed
- **Purpose**: Tracks when a user views the diff comparison between original and refactored code.

---

### 4. Code Health Monitor Events

#### `code-health-monitor/visibility`
- **Source**:
  - src/code-health-monitor/tree-view.ts:49
- **Event Data**:
  - `visible` (boolean): Whether the Code Health Monitor view is visible
- **Purpose**: Tracks visibility changes of the Code Health Monitor tree view panel.

#### `code-health-monitor/file-updated`
- **Source**:
  - src/code-health-monitor/delta-analysis-tree-provider.ts:148
  - src/code-health-monitor/home/home-view.ts:152
- **Event Data**:
  - `visible` (boolean): Whether the view is visible
  - `scoreChange` (number): Change in code health score
  - `nIssues` (number): Number of code health issues
  - `nRefactorableFunctions` (number): Number of functions that can be refactored (delta-analysis only)
- **Purpose**: Tracks when a file's code health analysis is updated with new results.

#### `code-health-monitor/file-added`
- **Source**:
  - src/code-health-monitor/delta-analysis-tree-provider.ts:157
  - src/code-health-monitor/home/home-view.ts:161
- **Event Data**:
  - `visible` (boolean): Whether the view is visible
  - `scoreChange` (number): Change in code health score
  - `nIssues` (number): Number of code health issues
  - `nRefactorableFunctions` (number): Number of functions that can be refactored (delta-analysis only)
- **Purpose**: Tracks when a new file with code health issues is added to the monitor.

#### `code-health-monitor/file-removed`
- **Source**:
  - src/code-health-monitor/delta-analysis-tree-provider.ts:165, 172
  - src/code-health-monitor/home/home-view.ts:177
- **Event Data**:
  - `visible` (boolean): Whether the view is visible
- **Purpose**: Tracks when a file is removed from the Code Health Monitor (either improved or deleted).

---

### 5. Code Health Details Events

#### `code-health-details/visibility`
- **Source**:
  - src/code-health-monitor/details/view.ts:58, 61
  - src/code-health-monitor/home/home-view.ts:238, 244
- **Event Data**:
  - `visible` (boolean): Whether the Code Health Details view is visible
- **Purpose**: Tracks visibility changes of the Code Health Details panel.

#### `code-health-details/function-selected`
- **Source**: src/code-health-monitor/details/view.ts:134
- **Event Data**:
  - `visible` (boolean): Whether the view is visible
- **Purpose**: Tracks when a user selects a function in the Code Health Details view.

#### `code-health-details/function-deselected`
- **Source**: src/code-health-monitor/details/view.ts:141
- **Event Data**:
  - `visible` (boolean): Whether the view is visible
- **Purpose**: Tracks when a user deselects a function in the Code Health Details view.

---

### 6. Documentation Events

#### `openInteractiveDocsPanel`
- **Source**:
  - src/documentation/commands.ts:16
  - src/documentation/commands.ts:23
- **Event Data**:
  - `source` (string): Where the docs were opened from (e.g., "diagnostic-item", "code-lens")
  - `category` (string): The category/type of code health issue being documented
- **Purpose**: Tracks when users open the interactive documentation panel to learn about code health issues.

#### `openCodeHealthDocs`
- **Source**: src/documentation/commands.ts:56
- **Event Data**: None
- **Purpose**: Tracks when users open the general Code Health documentation.

---

### 7. Control Center Events

#### `control-center/visibility`
- **Source**:
  - src/control-center/view-provider.ts:54
  - src/control-center/view-provider.ts:65
- **Event Data**:
  - `visible` (boolean): Whether the Control Center view is visible
- **Purpose**: Tracks visibility changes of the Control Center webview panel.

#### `control-center/open-settings`
- **Source**:
  - src/control-center/view-provider.ts:81
  - src/code-health-monitor/home/cwf-message-handlers.ts:106
  - src/codescene-tab/webview/documentation/cwf-webview-docs-panel.ts:97
- **Event Data**: None
- **Purpose**: Tracks when users click to open extension settings from the Control Center or other panels.

#### `control-center/open-link`
- **Source**: src/control-center/view-provider.ts:112
- **Event Data**:
  - `url` (string): The URL that was opened
- **Purpose**: Tracks when users click external links from the Control Center (e.g., documentation, pricing, support).

---

### 8. Code Health Rules Events

#### `createRulesTemplate`
- **Source**: src/code-health-rules/index.ts:9
- **Event Data**: None
- **Purpose**: Tracks when users create a new code-health-rules.json template file.

#### `checkRules`
- **Source**: src/code-health-rules/index.ts:15
- **Event Data**: None
- **Purpose**: Tracks when users manually trigger a code health rules check.

---

### 9. Statistics Events

#### `stats`
- **Source**: src/stats.ts:37
- **Event Data**:
  - `stats.analysis` (object): Analysis statistics by language
    - `language` (string): File extension/language
    - `runs` (number): Number of analysis runs
    - `avgTime` (number): Average execution time in milliseconds
    - `maxTime` (number): Maximum execution time in milliseconds
- **Purpose**: Automatically sent every 30 minutes to track code analysis performance metrics by programming language. Helps identify performance issues and usage patterns.

---

### 10. Error Events

#### `vscode/unhandledError`
- **Source**: src/telemetry.ts:124
- **Event Data**:
  - Serialized error object containing:
    - `message` (string): Error message (may be redacted)
    - `stack` (string): Stack trace (may be redacted)
    - `name` (string): Error name
    - `extraData` (optional object): Additional context data provided when the error was logged
- **Purpose**: Tracks unhandled errors and exceptions in the extension. Limited to 5 errors per session to prevent excessive reporting. Fully redacted errors (containing only generic secrets placeholders) are not sent.

---

## Privacy and Security

- All telemetry is controlled by the `enableTelemetry` configuration setting
- VS Code automatically sanitizes stack traces and user data before sending
- Errors containing only redacted content (generic secret placeholders) are not sent
- Error reporting is limited to 5 errors per session to prevent excessive network usage
- Users are notified on first run that telemetry is enabled and can disable it in settings

## Telemetry Flow

1. Events are logged via `Telemetry.logUsage(eventName, eventData)` or `Telemetry.logError(error, skipLogging, data)`
2. Events are enriched with standard metadata (timestamp, version, platform, user-id)
3. Events are posted to the DevtoolsAPI endpoint
4. All telemetry respects the user's `enableTelemetry` configuration setting
