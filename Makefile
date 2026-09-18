.PHONY: default ci build lint typecheck test serve dev

default: ci
ci: build lint typecheck test

build:
	npm run build

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm test

serve:
	npm run serve

dev:
	npm run dev
