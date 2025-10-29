.PHONY: build package tsc clean lint watch test pretest updatedocs

.DEFAULT_GOAL := build

build:
	npm run build

package:
	vsce package

tsc:
	npx tsc --noEmit

lint:
	npm run lint

watch:
	npm run watch

pretest:
	npm run pretest

test: pretest
	npm run test

updatedocs:
	npm run updatedocs

clean:
	npm run clean
