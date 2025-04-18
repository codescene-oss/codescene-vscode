# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.9.15](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.14...v0.9.15) (2025-04-18)


### Bug fixes

* **code-health-monitor:** No badge if >99 issues in code health monitor ([5f5911c](https://github.com/codescene-oss/codescene-vscode/commit/5f5911c14828da7e657f28b36d3e52ff007a7bd0))

### [0.9.14](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.13...v0.9.14) (2025-04-02)


### Bug fixes

* **devtools-binary:** Optimize C# parsing for large files ([90dc6cc](https://github.com/codescene-oss/codescene-vscode/commit/90dc6cc491ccf29aacdd0d720871d8d4bd8fd21a))

### [0.9.13](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.12...v0.9.13) (2025-03-12)


### Bug fixes

* **devtools-binary:** Bump version to include some fixes in the analysis ([4772696](https://github.com/codescene-oss/codescene-vscode/commit/47726962cb8cdb889d4255499af43155c85e464a))

### [0.9.12](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.11...v0.9.12) (2025-02-12)


### Bug fixes

* **code-health-monitor:** Don't go to top of document when position is missing ([56437bd](https://github.com/codescene-oss/codescene-vscode/commit/56437bd9a705a9ab690ea49fd4c56b61b3aa3eb8))

### [0.9.11](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.10...v0.9.11) (2025-02-11)


### Bug fixes

* **devtools-binary:** Parsing certain python conditionals ([a85eb2a](https://github.com/codescene-oss/codescene-vscode/commit/a85eb2a7b6553924b151f7f2b9ed44428a5060b7))

### [0.9.10](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.9...v0.9.10) (2025-02-11)


### Features

* **code-health-monitor:** Include improvements and sorting of files ([09891e3](https://github.com/codescene-oss/codescene-vscode/commit/09891e3f8b5f17eee1635653cb7a5f46ac03c687))
* **code-health-monitor:** Show fixed issues and improvement opportunities ([dcda302](https://github.com/codescene-oss/codescene-vscode/commit/dcda3026a779af88ac5b42675853878bd247c1d5))

### [0.9.9](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.8...v0.9.9) (2025-01-28)


### Bug fixes

* **review:** Allow for undefined score meaning "no scorable code" ([93ba0e5](https://github.com/codescene-oss/codescene-vscode/commit/93ba0e5f0bd4829d61e9c457e96035d1a9fd7628))

### [0.9.8](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.7...v0.9.8) (2025-01-21)


### Features

* **refactoring:** Re-select code to be refactored when clicking the function location component (if applicable) ([42869d0](https://github.com/codescene-oss/codescene-vscode/commit/42869d0fc27d904f66c6e8a51d6708b9352a5757))


### Bug fixes

* **language-support:** Make sure review and refactoring DocumentMatchers are in sync with the analysis lib ([ad5657f](https://github.com/codescene-oss/codescene-vscode/commit/ad5657fc55c23d2b38eee4bf7f6a9cd0ea9741d7))
* Score rounding issues ([36abcd6](https://github.com/codescene-oss/codescene-vscode/commit/36abcd6a926ce29196eae87930820083199eb8bf))

### [0.9.7](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.6...v0.9.7) (2025-01-07)


### Features

* **control-center:** Retry ACE connection on error badge click ([d26b474](https://github.com/codescene-oss/codescene-vscode/commit/d26b474e1464025d2cd21b6d5b8719ce9e5cbd35))


### Bug fixes

* **code-health-details:** Correct icon for fixed issues ([7a39e27](https://github.com/codescene-oss/codescene-vscode/commit/7a39e273ab62fde35751e2459c3977e37d66d6d7))
* **code-health-details:** Properly refresh the code health details view when the monitor result is updated ([06c6123](https://github.com/codescene-oss/codescene-vscode/commit/06c6123ea70f09ad8bd73d483466ead8bcb49fde))
* **code-health-monitor:** Respect file delete/rename/move ([aa6f49f](https://github.com/codescene-oss/codescene-vscode/commit/aa6f49f250c5ceb54f73c5ced9de2f64f1c6a37f))
* **github:** Add GH_TOKEN to release run ([d81cc45](https://github.com/codescene-oss/codescene-vscode/commit/d81cc45130a58d7c0a2c83d0afbeccdb68e8d8b2))
* **refactoring:** Keep function range updated when content above has been changed ([195d66c](https://github.com/codescene-oss/codescene-vscode/commit/195d66c4800141535e4c6fec88e7454a0f879ec0))

### [0.9.6](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.5...v0.9.6) (2024-12-13)


### Features

* Add support for linux/arm64 platforms ([b43d11a](https://github.com/codescene-oss/codescene-vscode/commit/b43d11a053f67b8a31e8fab4ecfc4372a8f9aefe))

### [0.9.5](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.4...v0.9.5) (2024-12-12)


### Bug fixes

* **code-health-monitor:** Tooltip for code health info should reflect the score change ([6cf8618](https://github.com/codescene-oss/codescene-vscode/commit/6cf861845c11f0b557587a048d34897574d4a752))
* **control-center:** Make sure that control-center gets resolved while ensuring compatible binary and accepting T&C ([77cf187](https://github.com/codescene-oss/codescene-vscode/commit/77cf187dba9288e0939f4304855620125408962c))

### [0.9.4](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.3...v0.9.4) (2024-12-07)


### Bug fixes

* **telemetry:** Send acceptTermsAndPolicies event on startup ([5b526ab](https://github.com/codescene-oss/codescene-vscode/commit/5b526ab22b9311ef5a72f179bda50a82aa68f842))

### [0.9.3](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.2...v0.9.3) (2024-12-04)


### Bug fixes

* **refactoring-panel:** Do not show diff button on Unverified refactorings ([6134b00](https://github.com/codescene-oss/codescene-vscode/commit/6134b0053001ae2c4824a64d401549e401c4e5ec))

### [0.9.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.1...v0.9.2) (2024-11-29)


### Bug fixes

* **devtools-binary:** Update binary to handle crash on python .pyi files ([a354fd9](https://github.com/codescene-oss/codescene-vscode/commit/a354fd97824733dc28345b6e0ac98bf953118d92))
* **refactoring-panel:** Correctly present refactoring reasons when no reasons are provided (high/full conf) ([0a732b3](https://github.com/codescene-oss/codescene-vscode/commit/0a732b3215efe73243499f0c686303f890f26fbf))
* **refactoring/documentation:** Add file-changes message when applicable ([4e6d5ad](https://github.com/codescene-oss/codescene-vscode/commit/4e6d5ada0c6677aa0fad6bb0c5f108fa6608461b))
* **refactoring/documentation:** Close side panel if current document is closed ([7eca893](https://github.com/codescene-oss/codescene-vscode/commit/7eca893d2b88e10997afe77d0a0e325e00c244d9))

### [0.9.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.0...v0.9.1) (2024-11-22)


### Features

* **ace:** Change refactoring behaviour to on-demand only ([aa07f6d](https://github.com/codescene-oss/codescene-vscode/commit/aa07f6d354266d4f30eedf4a63f8dbe44ddacc7b))
* **refactoring:** Add an acknowledgement view the first time a refactoring is requested ([223caa4](https://github.com/codescene-oss/codescene-vscode/commit/223caa475c937c95b59cc3ed4e4b074a17b02e12))


### Bug fixes

* **control-center:** Opening settings outside of a workspace ([ef292cf](https://github.com/codescene-oss/codescene-vscode/commit/ef292cf1935112f34aa6ff6691fe46c8aa94425f))
* **refactoring:** Bug in supported code smells check ([57299cd](https://github.com/codescene-oss/codescene-vscode/commit/57299cd37135243f8b3aa667f0c544684cb46974))
* **statusbar:** Analysis keeps running on startup ([fb88e38](https://github.com/codescene-oss/codescene-vscode/commit/fb88e3817ab849598bbb936197b5eb0e09f71a98))

## [0.9.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.10...v0.9.0) (2024-11-06)


### Features

* **code-health-details:** Add new panel for viewing details about a function ([2d8c462](https://github.com/codescene-oss/codescene-vscode/commit/2d8c4624819b8dc1753de8433d58d89460369c5e))
* **code-health-monitor:** Misc improvements ([62b00b0](https://github.com/codescene-oss/codescene-vscode/commit/62b00b08ea7eb903b9eb0e54c8356ffa383450ea))
* **control-center:** Extension status and Out of ACE Credits presentation ([39776dc](https://github.com/codescene-oss/codescene-vscode/commit/39776dcbb9f62f827cdcc6fa9aa2ab8cf2887c68))
* **control-center:** First implementation of control-center panel from the new  UX ([78eaa5c](https://github.com/codescene-oss/codescene-vscode/commit/78eaa5c1dd982d93d079200cdf3035445acd8a7a))
* **refactoring:** Add anonymous refactoring access ([6b3f04f](https://github.com/codescene-oss/codescene-vscode/commit/6b3f04f2a83fafc5c3a6e487f63070223e4edceb))
* **terms-and-conditions:** Add agreement popup on extension activation ([54c4af9](https://github.com/codescene-oss/codescene-vscode/commit/54c4af94383699a16a7ae6ba284bf3915f8f5099))


### Bug fixes

* Bump devtools binary version to fix some code health monitoring issues ([8c79a89](https://github.com/codescene-oss/codescene-vscode/commit/8c79a892feb8e011e3d9b4147be2b522adf5137e))
* Changed behaviour of code health monitor codelens ([fb2ccdc](https://github.com/codescene-oss/codescene-vscode/commit/fb2ccdcad66d6ebceef362a83b55c5f1df9a2d2a))
* **code-health-details:** Better async handling for refactoring button ([09e40e2](https://github.com/codescene-oss/codescene-vscode/commit/09e40e2dec687c08fb639183dc2be47cd03b5c73))
* **code-health-monitor:** Calculate total score change and present in the monitoring tree ([d65c896](https://github.com/codescene-oss/codescene-vscode/commit/d65c896b7f5a05a22b5e239f93788e6022102dcc))
* **code-health-monitor:** Correct the sorting of functions ([8d555d9](https://github.com/codescene-oss/codescene-vscode/commit/8d555d94ce549671e103e573a9567d8fc7c6bb6b))
* **code-health-monitor:** Invalidate current refactorings for a file when applying a refactoring ([e83b020](https://github.com/codescene-oss/codescene-vscode/commit/e83b020cdb0166e50b6fc362bd07bd2b510b3fe0))
* **codelens:** Make sure score is properly updated on code change ([4a9c621](https://github.com/codescene-oss/codescene-vscode/commit/4a9c621f6079227b924ece1510d3be828389d711))
* **configuration:** Add extra defaults to config getters ([977d583](https://github.com/codescene-oss/codescene-vscode/commit/977d583d5208b175f3a930cda37f87258b65aa67))
* **interactive-docs-panel:** Make sure that existing refactorings are immediately available in the docs panel ([a7625ba](https://github.com/codescene-oss/codescene-vscode/commit/a7625ba4d1a56054bd9b10c2dcc47917f2471cb5))
* **readme:** Replace svg for png ([f8e3c4d](https://github.com/codescene-oss/codescene-vscode/commit/f8e3c4d2f9807cd1185e31e0c1e46b0e2ef4e67a))
* **review-stats:** Ensure that review stats collector is disposable ([4756aaf](https://github.com/codescene-oss/codescene-vscode/commit/4756aaf1f2405464afd79c5789bd099c82ef199a))
* **startup:** Wait until activation is finalized before enabling certain views and commands ([48b4199](https://github.com/codescene-oss/codescene-vscode/commit/48b4199a75e065f411d89955e296e59b8ab850c0))

### [0.7.10](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.9...v0.7.10) (2024-09-27)


### Features

* Add code action for ACE and interactive docs ([4b4b858](https://github.com/codescene-oss/codescene-vscode/commit/4b4b858eaa8435d5754b78ed15c5cfa2f721be21))
* **code-health-monitor:** Always compare changes to the current HEAD of the file ([85ccb89](https://github.com/codescene-oss/codescene-vscode/commit/85ccb897b1e0a935613579188947ed78b50832be))
* **code-health-monitor:** Code health monitor rename and new UX ([63d3f13](https://github.com/codescene-oss/codescene-vscode/commit/63d3f13f72e1ee15c3a2aab4090941cf31b86ff7))
* **codelens:** Implement a menu codelens triggered from functions in the code-health-monitor ([812d668](https://github.com/codescene-oss/codescene-vscode/commit/812d6689bda8f4389c652edd156a6ddc82cc9b6e))


### Bug fixes

* **codelens:** Correct argument for presentRefactoring command ([3336bbd](https://github.com/codescene-oss/codescene-vscode/commit/3336bbdff5c66d8cee6d4329f955e6def0d06d27))

### [0.7.9](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.8...v0.7.9) (2024-09-12)

### [0.7.8](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.7...v0.7.8) (2024-08-29)


### Features

* **code-health-gate:** Support for live updates on code changes ([a1f0d6e](https://github.com/codescene-oss/codescene-vscode/commit/a1f0d6e3313b37f9ffa91d62afffe4f7bb61ae28))
* **enterprise:** Use authProvider to sign out when changing serverUrl ([34e63b4](https://github.com/codescene-oss/codescene-vscode/commit/34e63b4378854f8b7e91b62cc2b7aad673e6531e))
* **language:** Add support for Bright[er]Script ([df409f1](https://github.com/codescene-oss/codescene-vscode/commit/df409f1938f030b62e0da21f2865151bb8d5abb7))


### Bug fixes

* **code-health-gate:** Stop analysis spinner when review scores are the same (or both are undefined) ([f5155a0](https://github.com/codescene-oss/codescene-vscode/commit/f5155a08460d108ea8f1a253cf42ff3629cedc1f))
* **code-health-rules:** Improved support for more intricate "matching_content_path"s ([cac3b9c](https://github.com/codescene-oss/codescene-vscode/commit/cac3b9cb0b06c2f1ac04765a02222ec1ff90ab5e))
* Notify by warning popup when review fails due to too long lines ([2821239](https://github.com/codescene-oss/codescene-vscode/commit/282123933be4631df406f6cb1872abef3d2730c6))

### [0.7.7](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.6...v0.7.7) (2024-06-28)

### [0.7.6](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.5...v0.7.6) (2024-06-26)


### Features

* **code-health-gate:** Delta analysis/code health gate initial commit ([74dd05f](https://github.com/codescene-oss/codescene-vscode/commit/74dd05fc933a9df24ebbaf78d7dca085eae73595))
* **code-health-gate:** Enable ACE for code-health-gate issues ([3769cb7](https://github.com/codescene-oss/codescene-vscode/commit/3769cb78d876432b669e128c7dd7447ffb71d8f5))
* **documentation:** Dynamic documentation panel initial commit ([76a89fe](https://github.com/codescene-oss/codescene-vscode/commit/76a89fe22b5892bbe5fd5809c2b284a2b8339936))
* **documentation:** Go to function location in document ([1673e70](https://github.com/codescene-oss/codescene-vscode/commit/1673e70bb7a18688e8edab36afbf7e5d47ae6b67))
* Reference a specific devtools binary version ([ff5c38e](https://github.com/codescene-oss/codescene-vscode/commit/ff5c38e0f06d340d56411af9342cb325308596b3))


### Bug fixes

* **code-health-gate:** Only show interactive docs for actual degradations ([8ccc356](https://github.com/codescene-oss/codescene-vscode/commit/8ccc356d00343a0a7b844d4261deaa5e4d57f9e8))
* Correct relative start/end-lines for codeSmells sent to ACE ([7cf05e5](https://github.com/codescene-oss/codescene-vscode/commit/7cf05e5ecee99a485851eb158859eb04b5a0c2e7))
* **diagnostics:** Add source to file level issues ([2ac8f3a](https://github.com/codescene-oss/codescene-vscode/commit/2ac8f3a28f232f64ac03ce63b4facd03afadf16b))
* **review:** Add codelens for files with no scorable code ([c9b0218](https://github.com/codescene-oss/codescene-vscode/commit/c9b02188f688b7592bfd109962204edadec3128d))
* Status view failing on startup with no binary nor internet connection ([7d8cc60](https://github.com/codescene-oss/codescene-vscode/commit/7d8cc6069430b82a445371ca9a7ff4c89163dd23))

### [0.7.5](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.4...v0.7.5) (2024-06-05)


### Bug fixes

* Add a large-method-guide.md for when presenting large method refactorings as Code Improvement Guides. ([f1a7baf](https://github.com/codescene-oss/codescene-vscode/commit/f1a7baf20488b9f1e82fb1d1ebd3f4b9563903a6))

### [0.7.4](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.3...v0.7.4) (2024-06-05)


### Bug fixes

* Check max-input-loc against the functions active code size (not counting comments) ([#61](https://github.com/codescene-oss/codescene-vscode/pull/61))
* Improved review error handling ([e45d155](https://github.com/codescene-oss/codescene-vscode/commit/e45d1557eaa2f3a6572e7bad46c69f6e110e054d))
* Review of empty documents hangs ([51ecbf8](https://github.com/codescene-oss/codescene-vscode/commit/51ecbf8a2bb124d28d896625f98d009e65d3d74e))

### [0.7.3](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.2...v0.7.3) (2024-05-13)


### Bug fixes

* Show errors from the check-rules command ([23feed1](https://github.com/codescene-oss/codescene-vscode/commit/23feed1c856880cada92777a1c80c540c070d264))

### [0.7.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.1...v0.7.2) (2024-05-08)


### Features

* Add loading indication in status-bar and Auto-refactor panel when reviewing code ([89b7c52](https://github.com/codescene-oss/codescene-vscode/commit/89b7c5228a512c98d574da8160b7c56033c05035))
* Added a check rules command to utilize check-rules in CLI ([663c2db](https://github.com/codescene-oss/codescene-vscode/commit/663c2dbf35051342bf86443bcf16b7d8f0f011c9))
* Code Health Review panel, a view of analysed files ([c93e7c2](https://github.com/codescene-oss/codescene-vscode/commit/c93e7c2a3466435923950a466688efef58ec1a3f))


### Bug fixes

* Cancels currently running login if initiating another while waiting ([9bfad0e](https://github.com/codescene-oss/codescene-vscode/commit/9bfad0e0e5bf48dd8b3225b4d34168c0228a796d))
* Get back review debounce behaviour on file changes ([fed400a](https://github.com/codescene-oss/codescene-vscode/commit/fed400a9cc56454a52fcf86631529169952e6e13))
* Regression in ACE activation when first signing in ([723718d](https://github.com/codescene-oss/codescene-vscode/commit/723718de38739bd6fb57ccf3f633a58dead15981))
* Show welcomeView for Auto-refactor panel when setting is disabled ([7ffec91](https://github.com/codescene-oss/codescene-vscode/commit/7ffec91da122d96a6d3516ed32f5fac37052e3c1))

### [0.7.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.7.0...v0.7.1) (2024-04-09)

## [0.7.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.6.1...v0.7.0) (2024-03-22)


### ⚠ BREAKING CHANGES

* Remove the Change Coupling feature ([7b59f6c](https://github.com/codescene-oss/codescene-vscode/commit/7b59f6cf9afd0a68ad7cad28ecf53cff38de8683)). This might be reworked and reinstated in a future release.
    
### Features

* New Activity bar icon with status view
* Status bar icon
* [CodeScene ACE](https://codescene.com/campaigns/ai) beta
  * Auto-refactor CodeLens ([3066106](https://github.com/codescene-oss/codescene-vscode/commit/3066106626be1ea29595591c3eb2dd475c89aacb))
  * Auto-Refactoring tree view (initial impl) ([85c682c](https://github.com/codescene-oss/codescene-vscode/commit/85c682c7cd9a8cacc1e7ab2f988114735900e333))
* Aborting running reviews when closing documents ([e9dea7f](https://github.com/codescene-oss/codescene-vscode/commit/e9dea7fdc583900b40f6b21ba68ecb89c84f5b50))  


### Bug fixes

* Correct next uri param for logging in to CodeScene Cloud ([4069727](https://github.com/codescene-oss/codescene-vscode/commit/406972707824a7c085c2683c0e87eda44559716f))
* Fail extension activation early if binary won't run properly ([e27f2c8](https://github.com/codescene-oss/codescene-vscode/commit/e27f2c899bf155f04309c451a988696bcf2038ab))
* Handle signing in/out without having to reload extension ([c8ac15b](https://github.com/codescene-oss/codescene-vscode/commit/c8ac15b099e4ef05394a8082c6aa14a2abffc591))
* Ignore expected abort-errors ([1f51364](https://github.com/codescene-oss/codescene-vscode/commit/1f51364982031204767654482e8a7ba0ee451daf))
* Packaging and Content-Security-Policy for webviews ([63cc9da](https://github.com/codescene-oss/codescene-vscode/commit/63cc9da601633cd43413025b5675d990ce4abb46))
* Show file level issues as warnings in Problems panel ([67f984c](https://github.com/codescene-oss/codescene-vscode/commit/67f984cbde61444144c72547bba611225931c324))
* Sign-in issue due to await on the popup window ([fd8f915](https://github.com/codescene-oss/codescene-vscode/commit/fd8f9159dbd208081f9dfa20b3ee98ce34d395ad))

### [0.6.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.6.0...v0.6.1) (2024-02-12)


### Bug fixes

* Sign-in url adapted to updated service ([d089585](https://github.com/codescene-oss/codescene-vscode/commit/d08958519f2ac27234a36dbf2ecaa7e39e7d00a2))

## [0.6.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.5.1...v0.6.0) (2023-11-13)


### Features

* Add darwin amd64 binary download capability ([3fb0295](https://github.com/codescene-oss/codescene-vscode/commit/3fb0295cacc562395775d3693b71c4125452e6f0))

### [0.5.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.5.0...v0.5.1) (2023-10-23)

## [0.5.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.4.0...v0.5.0) (2023-10-18)


### Features

* Simpler one-to-one mapping for change coupling ([#26](https://github.com/codescene-oss/codescene-vscode/issues/26)) ([bf4ecc3](https://github.com/codescene-oss/codescene-vscode/commit/bf4ecc3fad20673513a2f85c0f9fe80b3f1e71be))

## [0.4.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.3.1...v0.4.0) (2023-08-28)

### [0.3.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.3.0...v0.3.1) (2023-08-24)


### Features

* add login to codescene server to enable more advanced features ([1a65caa](https://github.com/codescene-oss/codescene-vscode/commit/1a65caa4c85609ea4150744aa7d4b31aac8cd8a4))

## [0.3.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.2.1...v0.3.0) (2023-05-08)


### Features

* Add support for complex conditional ([466c863](https://github.com/codescene-oss/codescene-vscode/commit/466c8634131e41869d37429af498a4bae1fef930))


### Documentation

* add docs for complex conditional ([3a2f9a0](https://github.com/codescene-oss/codescene-vscode/commit/3a2f9a0ba56f0cc08759e048119a1d7a02c9fc31))

### [0.2.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.2.0...v0.2.1) (2023-04-28)

## [0.2.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.1.3...v0.2.0) (2023-04-20)


### Features

* ignore files outside of the workspace ([1d5a95f](https://github.com/codescene-oss/codescene-vscode/commit/1d5a95f4b70461f2e27067f65dbdb3827e3f882b))
* respect .gitignore settings ([11f98c8](https://github.com/codescene-oss/codescene-vscode/commit/11f98c8562a1549a5e9d931c895916da62cb5d5c))


### Bug fixes

* error sending usage stats ([e0c9471](https://github.com/codescene-oss/codescene-vscode/commit/e0c9471c5440db9e95418057d3d4166479ad9dbb))

### [0.1.3](https://github.com/codescene-oss/codescene-vscode/compare/v0.1.2...v0.1.3) (2023-04-14)


### Bug fixes

* effectivize the execution of the 'cs' process ([cdfe308](https://github.com/codescene-oss/codescene-vscode/commit/cdfe308d75a2d21bc3300a8e6fb961a95041fac3))

### [0.1.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.1.1...v0.1.2) (2023-04-03)

### [0.1.1](https://github.com/empear-analytics/codescene-vscode/compare/v0.1.0...v0.1.1) (2023-03-29)

## [0.1.0](https://github.com/empear-analytics/codescene-vscode/compare/v0.0.21...v0.1.0) (2023-03-27)


### Features

* Add usage telemetry ([b068669](https://github.com/empear-analytics/codescene-vscode/commit/b06866937e0a2b389c163ed549df5526f1c82256))

### [0.0.21](https://github.com/empear-analytics/codescene-vscode/compare/v0.0.20...v0.0.21) (2023-03-02)


### Bug fixes

* ensure remote development works ([c052ed4](https://github.com/empear-analytics/codescene-vscode/commit/c052ed4a8abc08cd7757a6ad7a8f1143e1f4db85))

### [0.0.20](https://github.com/empear-analytics/codescene-vscode/compare/v0.0.19...v0.0.20) (2023-02-28)

### [0.0.19](https://github.com/empear-analytics/codescene-vscode/compare/v0.0.18...v0.0.19) (2023-02-24)


### Documentation

* fix spelling errors in docs ([4d43e13](https://github.com/empear-analytics/codescene-vscode/commit/4d43e13814d47748f718d48908c43c879a5e9ba9))
