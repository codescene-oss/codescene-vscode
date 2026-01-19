.PHONY: build package tsc clean lint watch test pretest updatedocs

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

watch:
	npm run watch

pretest:
	rm -rf out/
	chronic npm run pretest

test: pretest
	npm run test

# Runs just one test.
# Example: make test1 TEST='GitChangeObserver Test Suite'
test1: pretest
	@test -n "$(TEST)" || (echo "TEST parameter is required. Usage: make test1 TEST='test name'" && exit 1)
	npm run test -- --grep '$(TEST)'

updatedocs:
	npm run updatedocs

clean:
	npm run clean
