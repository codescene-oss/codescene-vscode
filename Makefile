.PHONY: build package tsc clean lint watch test pretest pretest-e2e test-e2e test-release updatedocs benchmark

.DEFAULT_GOAL := build

build:
	npm run build

package: lint pretest
	npm i
	npm run updatecwf
	test -z "$$(git status --porcelain)" || (echo "Error: Working directory must be clean (per git status)" && exit 1); \
	sed -i '' '/^cs-\*/d' .vscodeignore; \
	node ./scripts/bundle-cli-for-current-platform.js; \
	npx @vscode/vsce@3.7.1 package; \
	git checkout .vscodeignore; \

tsc:
	npx tsc --noEmit

lint:
	npx commitlint --from main --to HEAD --verbose
	npm run lint
	-cs delta main

watch:
	npm run watch

pretest:
	node -e "require('fs').rmSync('out',{recursive:true,force:true})"
	npm run pretest

test: pretest
	npm run test

E2E_CLEAN := $(if $(CLEAN),-Clean,)

# Requires PowerShell 7.0 or higher.
pretest-e2e:
	pwsh install-e2e.ps1 $(E2E_CLEAN)

# Add "CLEAN=1" to force re-download of VS Code and extension.
test-e2e: pretest-e2e
	dotnet test e2e/Codescene.E2E.Playwright.Tests.csproj	

# Performance benchmarks. Add "ITERATIONS=n" to override the per scenario iteration count.
benchmark: pretest
	$(if $(ITERATIONS),CS_BENCH_ITERATIONS=$(ITERATIONS) )npm run benchmark

# Runs just one test.
# Example: make test1 TEST='workspace-watch'
ifndef TEST
test1:
	$(error TEST parameter is required. Usage: make test1 TEST='test name')
else
test1: pretest
	npm run test -- --grep "$(TEST)"
endif

test-release:
	npm run release:test -- $(if $(BUMP),$(BUMP),patch)

updatedocs:
	npm run updatedocs

clean:
	npm run clean
