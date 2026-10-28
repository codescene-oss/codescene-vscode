.PHONY: build package tsc clean lint watch test pretest test-release updatecwf benchmark benchmark-isolated

.DEFAULT_GOAL := build

build: updatecwf
	npm run build

package: lint pretest
	npm i
	$(MAKE) updatecwf
	test -z "$$(git status --porcelain)" || (echo "Error: Working directory must be clean (per git status)" && exit 1); \
	sed -i '' '/^cs-\*/d' .vscodeignore; \
	node ./scripts/bundle-cli-for-current-platform.js; \
	npx @vscode/vsce@4.0.0 package; \
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

# Performance benchmarks. Add "ITERATIONS=n" to override the per scenario iteration count.
benchmark: pretest
	$(if $(ITERATIONS),CS_BENCH_ITERATIONS=$(ITERATIONS) )npm run benchmark

# Fresh Node process and cs-ide server per side, repeated CS_BENCH_ROUNDS times (default 3).
# Requires CS_BENCH_BEFORE_BIN and CS_BENCH_AFTER_BIN.
benchmark-isolated: pretest
	node scripts/isolated-benchmark.js

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

updatecwf:
	node ./scripts/update-cwf.js

clean:
	npm run clean
