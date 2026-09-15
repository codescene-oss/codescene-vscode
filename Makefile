.PHONY: build package tsc clean lint watch test pretest pretest-e2e test-e2e test-release updatedocs benchmark benchmark-compare

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
# Add "CLI=native" to spawn the Graal native JSON-RPC server instead of java -jar.
# JAR peak RSS is capped for a fair comparison; override with CS_BENCH_JAVA_XMX (default 512m).
benchmark: pretest
	$(if $(ITERATIONS),CS_BENCH_ITERATIONS=$(ITERATIONS) )$(if $(CLI),CS_BENCH_CLI=$(CLI) )npm run benchmark

benchmark-compare: pretest
	node ./scripts/bundle-native-cli.js
	$(if $(ITERATIONS),CS_BENCH_ITERATIONS=$(ITERATIONS) )CS_BENCH_OUTPUT=bench-results/jar npm run benchmark
	$(if $(ITERATIONS),CS_BENCH_ITERATIONS=$(ITERATIONS) )CS_BENCH_CLI=native CS_BENCH_OUTPUT=bench-results/native npm run benchmark
	node ./scripts/compare-benchmarks.js bench-results/jar/ide-server.json bench-results/native/native-ide-server.json

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
