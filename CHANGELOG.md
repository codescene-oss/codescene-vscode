# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
