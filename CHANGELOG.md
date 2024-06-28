# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
