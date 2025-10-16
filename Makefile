.PHONY: build package tsc clean lint watch test updatedocs

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

test:
	npm run test

updatedocs:
	npm run updatedocs

clean:
	npm run clean
