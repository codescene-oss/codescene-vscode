.PHONY: build package package-darwin-arm64 package-darwin-x64 package-linux-arm64 package-linux-x64 package-win32-x64 package-all tsc clean lint watch test pretest pretest-e2e test-e2e updatedocs updatecwf

.DEFAULT_GOAL := build

build: updatecwf
	npm run build

package: lint pretest
	npm i
	$(MAKE) updatecwf
	test -z "$$(git status --porcelain)" || (echo "Error: Working directory must be clean (per git status)" && exit 1); \
	sed -i '' '/^cs-\*/d' .vscodeignore; \
	node ./scripts/bundle-cli-for-current-platform.js; \
	npx @vscode/vsce@3.7.1 package; \
	git checkout .vscodeignore; \

package-darwin-arm64: lint pretest
	npm i
	cd ~/refactoring-agent/agent && $(MAKE) build-all
	mkdir -p ./bin
	cp ~/refactoring-agent/agent/target/aarch64-apple-darwin/release/cs-agent ./bin/cs-agent
	node ./scripts/package-platform.js darwin arm64

package-darwin-x64: lint pretest
	npm i
	cd ~/refactoring-agent/agent && $(MAKE) build-all
	mkdir -p ./bin
	cp ~/refactoring-agent/agent/target/x86_64-apple-darwin/release/cs-agent ./bin/cs-agent
	node ./scripts/package-platform.js darwin x64

package-linux-arm64: lint pretest
	npm i
	node ./scripts/package-platform.js linux arm64

package-linux-x64: lint pretest
	npm i
	node ./scripts/package-platform.js linux x64

package-win32-x64: lint pretest
	npm i
	node ./scripts/package-platform.js win32 x64

package-all: package-darwin-arm64 package-darwin-x64 package-linux-arm64 package-linux-x64 package-win32-x64

tsc:
	npx tsc --noEmit

lint:
	npx commitlint --from main --to HEAD --verbose
	npm run lint
	@(command -v cs >/dev/null 2>&1 && cs delta main) || true

watch:
	npm run watch

pretest:
	rm -rf out/
	chronic npm run pretest

test: pretest
	npm run test

E2E_CLEAN := $(if $(CLEAN),-Clean,)

# Requires PowerShell 7.0 or higher.
pretest-e2e:
	pwsh install-e2e.ps1 $(E2E_CLEAN)

# Add "CLEAN=1" to force re-download of VS Code and extension.
test-e2e: pretest-e2e
	dotnet test e2e/Codescene.E2E.Playwright.Tests.csproj	

# Runs just one test.
# Example: make test1 TEST='GitChangeObserver Test Suite'
test1: pretest
	@test -n "$(TEST)" || (echo "TEST parameter is required. Usage: make test1 TEST='test name'" && exit 1)
	npm run test -- --grep '$(TEST)'

updatedocs:
	npm run updatedocs

updatecwf:
	@if [ "$$(whoami)" = "vemv" ] && [ -d "../cs-webview" ]; then \
		echo "Building CWF locally from ../cs-webview..."; \
		(cd ../cs-webview && npm run build); \
		rm -rf ./cs-cwf; \
		cp -r ../cs-webview/build ./cs-cwf; \
		echo "CWF built and copied to ./cs-cwf"; \
	else \
		echo "Downloading CWF from GitHub releases..."; \
		npm run updatecwf; \
	fi

clean:
	npm run clean
