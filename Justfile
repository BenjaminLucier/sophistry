# sophistry — monorepo orchestration
#
# `packages/*` are the published libraries (core, bindings, charts, text, 3d), `apps/`
# holds demo/site apps, `docs/` holds the documentation site. All are members
# of the one pnpm workspace defined in pnpm-workspace.yaml.

default:
    @just --list

# install all workspace dependencies
setup:
    pnpm install

# run the playground app (vite dev server)
play:
    pnpm --filter playground dev

# build the playground app
build:
    pnpm --filter playground build

# typecheck every package
typecheck:
    pnpm typecheck

# lint (biome)
lint:
    pnpm lint

# autofix lint + format
fmt:
    pnpm format

# run every package's test suite
test:
    pnpm test

# run the library's tests in watch mode
watch:
    pnpm --filter @sophistry/core test:watch

# everything CI should run (mirrors .github/workflows/ci.yml)
check: lint typecheck test examples docs-typecheck build-lib build-docs

# real-browser tests (Playwright/Chromium): builds the docs, then runs e2e/
e2e:
    pnpm test:e2e

# gallery visual regression in the Playwright Linux container (needs Docker)
[positional-arguments]
e2e-visual *args:
    pnpm test:e2e:visual "$@"

# regenerate the gallery baselines in e2e/__screenshots__/gallery (needs Docker)
[positional-arguments]
e2e-update *args:
    pnpm test:e2e:update "$@"

# --- library ---

# typecheck every @example in the library's JSDoc
examples:
    pnpm --filter @sophistry/codegen check:examples

# build every published package to packages/*/dist
build-lib:
    pnpm build

# run tests with coverage
coverage:
    pnpm --filter @sophistry/core exec vitest run --coverage

# list exactly what would be published to npm (no upload)
pack: build-lib
    for p in core text charts 3d solidjs react; do (cd packages/$p && pnpm pack --dry-run); done

# --- docs ---

# docs dev server with hot reload (http://localhost:4321)
docs:
    pnpm --filter @sophistry/docs dev

# typecheck every gallery example (and the rest of the docs sources)
docs-typecheck:
    pnpm --filter @sophistry/docs typecheck

# production docs build
build-docs:
    pnpm --filter @sophistry/docs build

# build then serve the production docs locally
docs-preview: build-docs
    pnpm --filter @sophistry/docs preview

# --- releases (changesets) ---

# describe a change to a published package (creates .changeset/*.md)
change:
    pnpm changeset

# show pending version bumps
status:
    pnpm changeset status

# apply pending changesets: bump versions and write CHANGELOGs (local only)
version:
    pnpm run version

# --- housekeeping ---

# upgrade-check dependencies (read-only)
outdated:
    pnpm outdated -r

# reinstall from the lockfile exactly as CI does
ci-install:
    pnpm install --frozen-lockfile

# nuke build output and caches, keeping node_modules
clean-build:
    rm -rf packages/*/dist packages/*/coverage docs/dist docs/.astro apps/*/dist

# remove node_modules and build output
clean:
    rm -rf node_modules packages/*/node_modules apps/*/node_modules docs/node_modules packages/*/dist packages/*/coverage

# pack the library, install it into a throwaway project and render it headless
smoke:
    pnpm smoke:consumer
