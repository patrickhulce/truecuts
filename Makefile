.PHONY: default ci build lint typecheck test serve dev

default: ci
ci: build lint typecheck test

build:
	pnpm run build

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

test:
	pnpm test

serve:
	pnpm run serve

dev:
	pnpm run dev
