# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.25.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.24.2...v0.25.0) (2025-12-30)


### Features

* prevent CLI commands from running over non-existing cwds ([084cf4a](https://github.com/codescene-oss/codescene-vscode/commit/084cf4ab791f273d088b960ec21c4dd1a5ca880a))

### [0.24.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.24.1...v0.24.2) (2025-12-22)


### Bug fixes

* correctly fix CS-6117 ([3041ea5](https://github.com/codescene-oss/codescene-vscode/commit/3041ea542206ef62a5575f323208b1a2ca6656d7))

### [0.24.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.24.0...v0.24.1) (2025-12-22)


### Bug fixes

* fix an initialization order ([ca5e299](https://github.com/codescene-oss/codescene-vscode/commit/ca5e2995ba6a7a1ebb94393185e26546d0929a48))

## [0.24.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.23.1...v0.24.0) (2025-12-21)


### Features

* files shown in UI tabs should be excluded from analysis heuristic ([11515f1](https://github.com/codescene-oss/codescene-vscode/commit/11515f1aea2b32e626c9afe34809ad39bd73cc70))


### Bug fixes

* reflect unsaved changes on the Code Health Monitor ([e2d29a6](https://github.com/codescene-oss/codescene-vscode/commit/e2d29a6989bbdd42030a4c3463311da80c560626))

### [0.23.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.23.0...v0.23.1) (2025-12-18)


### Features

* files directly saved by the user should be excluded from heuristics ([cedf735](https://github.com/codescene-oss/codescene-vscode/commit/cedf735451c4eea78fd539b230830640ab782a14))

## [0.23.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.22.2...v0.23.0) (2025-12-18)


### Features

* use heuristic to avoid analyzing most untracked files ([8fdfa05](https://github.com/codescene-oss/codescene-vscode/commit/8fdfa05f7d1fbf87eeffbc8b2d2db1350f36cf37))

### [0.22.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.22.1...v0.22.2) (2025-12-17)


### Bug fixes

* prevent the analysis of non-existing files ([29251a0](https://github.com/codescene-oss/codescene-vscode/commit/29251a09b4b9b2a2f69bd79faf3c1acb75657bf3))

### [0.22.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.22.0...v0.22.1) (2025-12-16)


### Bug fixes

* cached true skipMonitorUpdate values should lose priority over false ones ([a672899](https://github.com/codescene-oss/codescene-vscode/commit/a67289901a012dd40cf7aaf44b1f76ad0f3cea04))

## [0.22.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.21.0...v0.22.0) (2025-12-15)


### Features

* add a mechanism to deprecate old extension versions ([51d8b71](https://github.com/codescene-oss/codescene-vscode/commit/51d8b71b3a3316f57fe444fe9df9449d1b1648ae))
* exclude from analysis commonly irrelevant directories ([27c2a08](https://github.com/codescene-oss/codescene-vscode/commit/27c2a08124f67b202024c68c25800a1598853201))


### Bug fixes

* debounce workload in GitChangeObserver ([b0c8ee0](https://github.com/codescene-oss/codescene-vscode/commit/b0c8ee0ba4149f0c01e9427edbc30d6a58a53ccc))
* don't run scheduled Git tasks when Git unavailable ([83baea5](https://github.com/codescene-oss/codescene-vscode/commit/83baea552146cae6c807dc1ed589dd52e02ff20d))
* prevent analyses from Diagnostics from showing up in the Code Health Monitor ([87a3eb7](https://github.com/codescene-oss/codescene-vscode/commit/87a3eb7715eafb25155979057e4ecce425472c02))

## [0.21.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.20.0...v0.21.0) (2025-12-07)


### Features

* inform users when Git is unavailable ([c8f078f](https://github.com/codescene-oss/codescene-vscode/commit/c8f078facf73688e7e3c9bc2ac9e3182067c6097))


### Bug fixes

* prevent recursion while rendering docs ([3787b70](https://github.com/codescene-oss/codescene-vscode/commit/3787b70e66282ef81a07c15ac99c7faa9719dfdd))
* update CLI dependency to improve behavior on errors ([824538c](https://github.com/codescene-oss/codescene-vscode/commit/824538c0b7980846bf461aa32a40376cba5c0f07))

## [0.20.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.19.4...v0.20.0) (2025-12-04)


### Features

* catch any errors produced while invoking Telemetry ([d86a762](https://github.com/codescene-oss/codescene-vscode/commit/d86a762ce6481a4d94b3fdd494b9829203cb0517))

### [0.19.4](https://github.com/codescene-oss/codescene-vscode/compare/v0.19.3...v0.19.4) (2025-12-04)


### Bug fixes

* don't report fully redacted errors over the network ([e5f1441](https://github.com/codescene-oss/codescene-vscode/commit/e5f1441dd6d62195df63d646e33b390475ae8c9b))

### [0.19.3](https://github.com/codescene-oss/codescene-vscode/compare/v0.19.2...v0.19.3) (2025-12-03)

### [0.19.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.19.1...v0.19.2) (2025-12-03)


### Features

* never report more than 5 errors over Telemetry ([b2e211b](https://github.com/codescene-oss/codescene-vscode/commit/b2e211be9a77dc76594c7206242452e607f2d403))

### [0.19.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.19.0...v0.19.1) (2025-12-03)


### Bug fixes

* prevent recursive error reporting ([2374809](https://github.com/codescene-oss/codescene-vscode/commit/2374809dc213d3cf6ad1232a82ecd2d875686492))

## [0.19.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.18.0...v0.19.0) (2025-12-03)

### Features

* remove `Server Url` setting ([#242](https://github.com/codescene-oss/codescene-vscode/issues/242)) ([d4dfd7e](https://github.com/codescene-oss/codescene-vscode/commit/d4dfd7e5d48359e152186e60be46b728f20e2f45))
* platform specific extensions on marketplace ([cc43de1](https://github.com/codescene-oss/codescene-vscode/commit/cc43de16bafdfa9d6a940d4a003a1d8fc2d02c9c))

### Bug fixes

* add missing comma to c8 json ([b65746f](https://github.com/codescene-oss/codescene-vscode/commit/b65746f7720dfa5a1ea09f260ae96964973e32a0))
* make 'Show Diff' button idempotent ([#243](https://github.com/codescene-oss/codescene-vscode/issues/243)) ([48b8927](https://github.com/codescene-oss/codescene-vscode/commit/48b8927535d4dd16f1f89571f097af577dcee1f9))
* prevent duplicate logging in certain circumstances ([a4c4683](https://github.com/codescene-oss/codescene-vscode/commit/a4c46836850fb619098ae35e771a9135786f6399))

## [0.18.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.17.2...v0.18.0) (2025-11-30)

### Features

* cached reviews should use code-health-rules.json as part of the cache key ([#237](https://github.com/codescene-oss/codescene-vscode/issues/237)) ([08e8541](https://github.com/codescene-oss/codescene-vscode/commit/08e8541ef567bc68a4ab621c00e4fa59c164dca9))
* hide 'Sign In' commands ([#240](https://github.com/codescene-oss/codescene-vscode/issues/240)) ([3764436](https://github.com/codescene-oss/codescene-vscode/commit/37644360cbd87d26a94f4e661639e8c0df063bda))
* send errors over Telemetry ([#229](https://github.com/codescene-oss/codescene-vscode/issues/229)) ([0d7cc3e](https://github.com/codescene-oss/codescene-vscode/commit/0d7cc3e45a630bf700cb20927b6946043e2ba877))


### Bug fixes

* avoid recursion when relaying errors through Telemetry ([#234](https://github.com/codescene-oss/codescene-vscode/issues/234)) ([e0f4d3b](https://github.com/codescene-oss/codescene-vscode/commit/e0f4d3bfceaeedc60e2b9de1128a305b3ef1db98))
* improve extension deactivation ([e41661a](https://github.com/codescene-oss/codescene-vscode/commit/e41661a52488dbbac6ffb4bdbe9739a485881c32))
* set GIT_OPTIONAL_LOCKS=0 ([1894774](https://github.com/codescene-oss/codescene-vscode/commit/1894774dd09a7722c65016aedcae7129c82b7a58))
* simplify GitChangeLister ([#233](https://github.com/codescene-oss/codescene-vscode/issues/233)) ([10ef136](https://github.com/codescene-oss/codescene-vscode/commit/10ef136f431957f61042083603c7c21f1ef30427))

### [0.17.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.17.1...v0.17.2) (2025-11-24)


### Bug fixes

* add ability to parse Git filenames containing whitespace ([b1dddba](https://github.com/codescene-oss/codescene-vscode/commit/b1dddba00a1facc7ff73307f20745e00d5dbcfbf))
* support monorepos in Git operations ([#227](https://github.com/codescene-oss/codescene-vscode/issues/227)) ([e7d94c6](https://github.com/codescene-oss/codescene-vscode/commit/e7d94c664c50eddaf730357e7486ab3d49dd9f58))

### [0.17.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.16.1...v0.17.1) (2025-11-21)


### Features

* abort tasks on quit ([48cb199](https://github.com/codescene-oss/codescene-vscode/commit/48cb19906817cf7e519dd521dd2b15177134a116))
* cache most `fns-to-refactor` calls ([59d4f23](https://github.com/codescene-oss/codescene-vscode/commit/59d4f2359cbd756da2588e8cb4441cf912ae3d28))
* implement DroppingScheduledExecutor ([e28832c](https://github.com/codescene-oss/codescene-vscode/commit/e28832c26f5ff7f4a0e7cbe0989f19e1719d88f8))
* include error codes in error reporting toast ([5952945](https://github.com/codescene-oss/codescene-vscode/commit/59529453759ce3f3ac0ebaf27395d512786743f7))
* introduce `filenameInspectorExecutor` ([6c45280](https://github.com/codescene-oss/codescene-vscode/commit/6c45280c23e81da1152cdea91407e727ac79aafa))
* introduce QueuedSingleTaskExecutor ([e37dc1f](https://github.com/codescene-oss/codescene-vscode/commit/e37dc1f77ed5b463d2fba0e1573f20b4b9f19427))
* make `ConcurrencyLimitingExecutor` abort pending tasks on `dispose` ([cc1d4ec](https://github.com/codescene-oss/codescene-vscode/commit/cc1d4ecd673bf215054337e23d32fde883cbe349))
* make GitChangeLister also observe the diff vs the mergeBase ([df777bc](https://github.com/codescene-oss/codescene-vscode/commit/df777bc2ec1edb63c73a75d02801de2677f9f85e))
* make the Code Health Monitor react to Git changes ([27d8a4e](https://github.com/codescene-oss/codescene-vscode/commit/27d8a4ec0837bf1b73621dafc5ce1ff3e9eae30a))
* observe files open by the user ([fd6c0b8](https://github.com/codescene-oss/codescene-vscode/commit/fd6c0b88d589acd9db9a1eb6536d6bfaa6213879)), closes [src/extension.ts#L147-L185](https://github.com/src/extension.ts/issues/L147-L185)
* only present Diagnostic off the files directly open by the user ([eebb519](https://github.com/codescene-oss/codescene-vscode/commit/eebb519dea83801cd93c7bdf49411016c6d701d5))
* restore SingleTaskExecutor for `refactor` tasks ([2eca0a4](https://github.com/codescene-oss/codescene-vscode/commit/2eca0a428115ae5fa76a09c8007970c72f2d4226))
* run Delta tasks though abortingSingleTaskExecutor ([a04c1e1](https://github.com/codescene-oss/codescene-vscode/commit/a04c1e157303eb2e131ce29d2937229ba9526a33))
* run GitChangeLister through a DroppingScheduledExecutor ([bec3d77](https://github.com/codescene-oss/codescene-vscode/commit/bec3d773325b74c16c0cea32bdeb56307d1a0598))
* use a deletion tracker in GitChangeObserver ([e471dd1](https://github.com/codescene-oss/codescene-vscode/commit/e471dd1f84e84837b8ecf6a0c4da2802e6e9f267))
* use caches in fns-to-refactor calls ([ce32d52](https://github.com/codescene-oss/codescene-vscode/commit/ce32d52f0ca359ddd367adec636ef029dd97e86a))
* use Git merge-base to filter out irrelevant Git changes ([ea9a1d2](https://github.com/codescene-oss/codescene-vscode/commit/ea9a1d2585664aa8b3044982e66c6034424ee7d8))


### Bug fixes

* correctly use FilteringReviewer from OpenFilesObserver ([0b5ba23](https://github.com/codescene-oss/codescene-vscode/commit/0b5ba2336e8e88be3bbe466c5fd99361d2342f15))
* don't `await` `checkFirstRun` ([3a6b716](https://github.com/codescene-oss/codescene-vscode/commit/3a6b716ffd911f5cf8a1c7f9c246482d17566fab))
* execFile - set a maxBuffer ([07197bc](https://github.com/codescene-oss/codescene-vscode/commit/07197bcfad85cf0f3eee231774828f7c0499d753))
* gracefully handle absent repositories ([d02c94e](https://github.com/codescene-oss/codescene-vscode/commit/d02c94e42eca6b4c1de51923135148527c6745c4))
* handle CLI errors with code 10 but no error details ([79dfd78](https://github.com/codescene-oss/codescene-vscode/commit/79dfd7843da11ef081e1560a9eb851a489f50e1e))
* honor User settings when Workspace settings are blank ([b89ac4f](https://github.com/codescene-oss/codescene-vscode/commit/b89ac4f444ed6a244b88d5150ae6f464351523e7))
* improve GitChangeObserver deletion accuracy ([6b7eaf2](https://github.com/codescene-oss/codescene-vscode/commit/6b7eaf238c2efbb693cbb54765f4a2826a1fa109))
* incorrect line count in ace view ([801279c](https://github.com/codescene-oss/codescene-vscode/commit/801279c063d1a9471b7927f820f211d6a0f9be63))
* make `getStatusChanges` work correctly for file deletion handling ([974506f](https://github.com/codescene-oss/codescene-vscode/commit/974506fdcf332efa832dd9fa602b9d26e3ecda12))
* make deletions go through Git filtering in GitChangeObserver ([349e355](https://github.com/codescene-oss/codescene-vscode/commit/349e355658d5018df1fbddad66abded9048dca3f))
* observe directory deletion events ([a1d0d08](https://github.com/codescene-oss/codescene-vscode/commit/a1d0d08e1fd98c1031dc4877b75e58e937a4b6d1))
* OpenFilesObserver: use FilteringReviewer ([f8ac96e](https://github.com/codescene-oss/codescene-vscode/commit/f8ac96e962ef04190efa1ce745e89224c543513b))
* parse stdout on known error codes (and bump cli to corresponding version) ([180af6d](https://github.com/codescene-oss/codescene-vscode/commit/180af6de50f834f3a3742d63979a9758ac0aa510))
* produce correct `cwd` values on Windows ([7bb0ddf](https://github.com/codescene-oss/codescene-vscode/commit/7bb0ddf8cfbe622410269803dbdfdf91962b7ae1))
* run telemetry through the SingleTaskExecutor ([65d4bca](https://github.com/codescene-oss/codescene-vscode/commit/65d4bca96561c116baed8ab0f4154f6babcbbe75))
* temporarily disable staleness detection ([048b37c](https://github.com/codescene-oss/codescene-vscode/commit/048b37cb194db8401cad75bee215c8ae10b04c97))
* turn error notifications about server connection into warning logs ([1cddb81](https://github.com/codescene-oss/codescene-vscode/commit/1cddb816e368386f3aef6d3a2d1121d47e9bd154))
* use CLI 1.0.24 ([b180115](https://github.com/codescene-oss/codescene-vscode/commit/b180115d44b384606a5d87a72cbaf418b0e243a3))

### [0.16.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.16.0...v0.16.1) (2025-11-03)


### Documentation

* minor rephrasing and spell corrections ([6633008](https://github.com/codescene-oss/codescene-vscode/commit/66330084ef1badcaa94f974d2166d66ce9256f8b))

## [0.16.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.15.0...v0.16.0) (2025-11-03)


### Features

* introduce codescene.authToken setting ([ed6dd32](https://github.com/codescene-oss/codescene-vscode/commit/ed6dd3251ab0b44da5dacbb57462e0c54bbd20ea))
* make tokens mandatory for fn-to-refactor ([33cd4fd](https://github.com/codescene-oss/codescene-vscode/commit/33cd4fd13f56a1f7cda4134fdf04a931ce78bc7d))
* reload window for new webview ([f13416a](https://github.com/codescene-oss/codescene-vscode/commit/f13416ab71d159af1096799b28050f3acebae81c))
* remove baseline selector from monitor ui ([118531b](https://github.com/codescene-oss/codescene-vscode/commit/118531ba2b005775e8a379262d139098136439e2))
* render `Declarations for Refactored Code` when available ([455df4c](https://github.com/codescene-oss/codescene-vscode/commit/455df4c789c7e686428783dbf5c8e0f5e7700beb))
* restore ACE ([dda24a1](https://github.com/codescene-oss/codescene-vscode/commit/dda24a11a535eb9c38ba037a09d00ac86bf9ea29))
* split 'Activate' status into 'Signed in' / 'Signed out' ([a6e71bc](https://github.com/codescene-oss/codescene-vscode/commit/a6e71bc9b80d9016787427b74b501dbaa30bc4d6))
* **status:** split status bar into two distinct states for ACE and Analysis ([55ee550](https://github.com/codescene-oss/codescene-vscode/commit/55ee550eeff7bdf91cddedf24c87d8b85d05cd03))
* **telemetry:** enable copying device ID from command palette ([7378680](https://github.com/codescene-oss/codescene-vscode/commit/737868091e86a18b40e6933241c73670270ed1ae))
* use `--fn-to-refactor-nippy-b64` when available ([89e85b8](https://github.com/codescene-oss/codescene-vscode/commit/89e85b8fddf5711aff553757a8300602182a9b8f))


### Bug fixes

* code smell complex method ([b45875b](https://github.com/codescene-oss/codescene-vscode/commit/b45875b4f3ed7f5d71799691b56818f62259e0ef))
* decorate refactored code with review issues ([ef7c01a](https://github.com/codescene-oss/codescene-vscode/commit/ef7c01a6309e7b20aa1c9c08ded2c5e04e5ba4f1))
* don't skip cache when retrying a failed refactoring ([a470abc](https://github.com/codescene-oss/codescene-vscode/commit/a470abc9e317aedf6d9a9d5e521e948966fdba1e))
* fix copy button for Declarations section ([175b8ec](https://github.com/codescene-oss/codescene-vscode/commit/175b8eca651c10ed752d0c623480e760f90902d1))
* fix CS-5276 ([7c2eb8d](https://github.com/codescene-oss/codescene-vscode/commit/7c2eb8d4edcdf8e07247e7500f86446a1efc858f))
* update code health monitor reliably ([2488768](https://github.com/codescene-oss/codescene-vscode/commit/24887682a91341667888653ede3e4b2737018508))

## [0.15.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.14.4...v0.15.0) (2025-10-17)

### Bug fixes

* Minimize the number of simultaneus reviews ([fef3798](https://github.com/codescene-oss/codescene-vscode/commit/fef379866812c50e5ac89bb05071cd7e222742bb))
* **terms-and-policies** Remove terms and policies ([d3efec9](https://github.com/codescene-oss/codescene-vscode/commits/d3efec9088187248a45627b013189accaac0a311))

### [0.14.4](https://github.com/codescene-oss/codescene-vscode/compare/v0.14.3...v0.14.4) (2025-10-07)


### Features

* add Sign Out command ([43a0657](https://github.com/codescene-oss/codescene-vscode/commit/43a06571b54b6c51f71d9b2fd293236660bc7a77))
* Bump CLI version to 1.0.10 ([8beb94f](https://github.com/codescene-oss/codescene-vscode/commit/8beb94f5b03fdcd052609a7208d5ac29839634b2))


### Bug fixes

* access reviewResults safely ([3472686](https://github.com/codescene-oss/codescene-vscode/commit/3472686f3aeda11c164a5ffa20b6aad109af7d08))
* add --output-format json in missing places ([2424bd9](https://github.com/codescene-oss/codescene-vscode/commit/2424bd9158b11961d81faf4b6852a340a4053c60))
* **delta:** run command from the right cwd ([fad67cb](https://github.com/codescene-oss/codescene-vscode/commit/fad67cb3fb6200150525d44954226864cb94c518))
* **telemetry:** don't call getDeviceId when telemetry is disabled ([ae7224b](https://github.com/codescene-oss/codescene-vscode/commit/ae7224b84db10a2badbef7fa524ec6e8216bb40f))

### [0.14.3](https://github.com/codescene-oss/codescene-vscode/compare/v0.14.2...v0.14.3) (2025-10-02)


### Bug fixes

* Update ACE messaging ([3cc5aa9](https://github.com/codescene-oss/codescene-vscode/commit/3cc5aa9eb2693642b816d5d10743ba0ed63d7649))

### [0.14.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.14.0...v0.14.2) (2025-10-02)

### Bug fixes

* **baseline:** Show baseline in monitor ([847447c](https://github.com/codescene-oss/codescene-vscode/commit/847447cbaf51abaec2284e0b68b596f509b14cee))

### [0.14.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.14.0...v0.14.1) (2025-09-19)

### Features

* **code-health-monitor:** Improve code health review time by 50% (CLI version 1.0.8) ([6cfe166](https://github.com/codescene-oss/codescene-vscode/commit/6cfe16640c390ffe8106675c4302bcef61b390e8))


## [0.14.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.12.1...v0.14.0) (2025-08-22)

### Features

* **ace:** CodeScene ACE, our AI-powered refactoring agent, was free during beta but will now be offered as an add-on to the extension. If you're interested in continuing to use CodeScene ACE or would like to share 
feedback, [reach out](https://codescene.com/contact-us-about-codescene-ace) to our Sales team. ([a9157f8](https://github.com/codescene-oss/codescene-vscode/commit/a9157f8eef583a1a58234c31dd9bebf87b8d3f33))

## [0.13.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.12.1...v0.13.0) (2025-08-21)


### Features

* **telemetry:**  telemetry is now optional, enabled by deafult ([b811ff5](https://github.com/codescene-oss/codescene-vscode/commit/b811ff5b18725e33c826c582e6fc097fd860dfdb))

### [0.12.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.12.0...v0.12.1) (2025-07-24)

## [0.12.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.11.2...v0.12.0) (2025-06-30)


### Features

* **ace:** introduce c# support ([3aa080d](https://github.com/codescene-oss/codescene-vscode/commit/3aa080de41d2fb3d6a230cc3737500cb52f704a6))


### Bug fixes

* **code-health-monitor:** Rework main branch detection logic ([caf9be2](https://github.com/codescene-oss/codescene-vscode/commit/caf9be2036a2836f4a7d5d5660e6772603a05cd3))

### [0.11.2](https://github.com/codescene-oss/codescene-vscode/compare/v0.11.1...v0.11.2) (2025-05-23)


### Bug fixes

* **code-health-score:** Readd label to Code Health score presentation ([7ae9e1b](https://github.com/codescene-oss/codescene-vscode/commit/7ae9e1b28c999bbe7345a7626ba8ed4b8da30047))

### [0.11.1](https://github.com/codescene-oss/codescene-vscode/compare/v0.11.0...v0.11.1) (2025-05-21)


### Bug fixes

* **codelens:** Remove 'Code Health:' prefix from score presentation ([335fb38](https://github.com/codescene-oss/codescene-vscode/commit/335fb3810f43f214b33a385614bc897480763f3f))
* **diagnostics:** Don't show general diagnostic for Code Health ([8b9a042](https://github.com/codescene-oss/codescene-vscode/commit/8b9a042cd8660972c902bc46995af69dd6fa46c5))

## [0.11.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.10.0...v0.11.0) (2025-05-20)


### Features

* **code-health-monitor:** Add baseline selector to Code Health Monitor ([c8818bd](https://github.com/codescene-oss/codescene-vscode/commit/c8818bdfaea35e4168e13604fea9eb804969074d))
* **code-health-monitor:** Add default baseline to Code Health Monitor ([6fc6e5f](https://github.com/codescene-oss/codescene-vscode/commit/6fc6e5fe3cea7dab2bb7c13c201207cf68bf5524))

## [0.10.0](https://github.com/codescene-oss/codescene-vscode/compare/v0.9.15...v0.10.0) (2025-05-20)


### Bug fixes

* **code-health-monitor:** Don't show "dismiss" lens without corresponding "ACE" lens ([7795e58](https://github.com/codescene-oss/codescene-vscode/commit/7795e58199127f45b28f2f11de094d47918f8194))
* **delta:** Do not throw when aborting a delta-analysis ([a258c6f](https://github.com/codescene-oss/codescene-vscode/commit/a258c6f4ec14c01e0fd064aaf2c90b622aae3458))
* **devtools-api:** Move analysis start/end event emission to the api ([9cdc8fc](https://github.com/codescene-oss/codescene-vscode/commit/9cdc8fc10a76ba2b14c8c1af798f7c5a61dd51df))
* Remove duplicate preflightStateListener ([3eefd4b](https://github.com/codescene-oss/codescene-vscode/commit/3eefd4b409519271cf4e9a227c8a18b3e8c34cfa))

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
