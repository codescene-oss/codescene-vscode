.PHONY: build package tsc clean lint watch test pretest updatedocs

.DEFAULT_GOAL := build

build:
	npm run build

package: lint pretest
	npm i
	npm run updatecwf
	vsce package

tsc:
	npx tsc --noEmit

lint:
	npx commitlint --from main --to HEAD --verbose
	npm run lint

watch:
	npm run watch

pretest:
	rm -rf out/
	npm run pretest

test: pretest
	npm run test

updatedocs:
	npm run updatedocs

clean:
	npm run clean
