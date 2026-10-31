# Contributing to sophistry

Thanks for helping out! Before starting anything larger than a fix, open an
issue or a discussion so we can agree on the approach. The
[roadmap](ROADMAP.md) lists what is planned and what is out of scope.

## Setup

Requires Node >= 24, pnpm and [just](https://just.systems).

```sh
pnpm install
just check   # lint, typecheck, tests, @example check, builds (what CI runs)
just play    # playground
just docs    # docs site at http://localhost:4321
```

## Repository layout

```
packages/
  core/      @sophistry/core: scenes, tweens, geometry, themes, Canvas2D renderer
  solidjs/   @sophistry/solidjs: SolidJS components and hooks
  react/     @sophistry/react: React components and hooks
  charts/    @sophistry/charts: charts and data marks
  text/      @sophistry/text: LaTeX and font outlines as geometry
  3d/        @sophistry/3d: 3D scenes projected onto the 2D canvas
  codegen/   generates the bindings' components from the packages' definitions (private)
apps/
  playground/  Vite + Solid + Tailwind scratch app (workspace-linked, instant HMR)
docs/          documentation site (Astro + Starlight, served at sophistry.dev)
e2e/           Playwright suite (engine fixtures, gallery visual regression)
sophistry-py/  reserved placeholder for future Python bindings
```

Each published package is built with Vite (library mode) plus `tsc` for
declarations, into its own `dist`. Inside the workspace the packages' `exports`
point at `src/`, so the playground and docs get instant HMR with no build; on
publish, `publishConfig.exports` swaps them for `dist/`. `just pack` shows
exactly what would be published. The six published packages are versioned
together (a `fixed` group in `.changeset/config.json`). Shared dependency
versions live in the `catalog:` block of `pnpm-workspace.yaml`. The bindings'
components are generated: run `pnpm codegen` after changing a definition
(`pnpm codegen:check` verifies it).

How the library is layered internally is in
[Architecture](https://sophistry.dev/project/architecture/); the plan and open
gaps are in the [roadmap](ROADMAP.md).

### Commands

| command               | what it does                                                  |
| --------------------- | ------------------------------------------------------------- |
| `just setup`          | `pnpm install`                                                |
| `just play` / `build` | run / build the playground                                    |
| `just check`          | everything CI runs: lint, typecheck, tests, examples, builds  |
| `just typecheck`      | typecheck every package                                       |
| `just lint` / `fmt`   | biome check / biome check --write                             |
| `just test`           | run every package's tests                                     |
| `just watch`          | core tests in watch mode                                      |
| `just examples`       | typecheck every `@example` in the packages' JSDoc             |
| `just coverage`       | core tests with coverage                                      |
| `just build-lib`      | build every published package to `dist/`                      |
| `just pack`           | dry-run the npm tarball                                       |
| `just smoke`          | install the packed tarball in a fresh project, load every entry in Chromium |
| `just docs`           | docs dev server                                               |
| `just docs-typecheck` | typecheck the docs sources and gallery examples               |
| `just build-docs` / `docs-preview` | production docs build / build and serve it       |
| `just e2e`            | build the docs, run the Playwright suite                      |
| `just e2e-visual` / `e2e-update` | gallery visual regression / regenerate baselines (Docker) |
| `just change` / `status` / `version` | add a changeset / show pending bumps / apply them locally |
| `just outdated`       | check for dependency upgrades                                 |
| `just ci-install`     | reinstall from the lockfile exactly as CI does                |
| `just clean-build` / `clean` | remove build output and caches / also node_modules     |

### Using a local checkout from another project

```json
"@sophistry/core": "link:../sophistry/packages/core",
"@sophistry/solidjs": "link:../sophistry/packages/solidjs"
```

A link resolves to `src/`, so the consumer's bundler compiles the TypeScript.
Add `resolve.dedupe: ["solid-js", "@solidjs/web"]` to the consumer's Vite
config so there is a single copy of Solid. Inside this workspace, depend on it
with `"@sophistry/core": "workspace:*"`.

## Workflow

- Branch from `main` and open a pull request.
- Run `pnpm format`, then `just check` (or at least `pnpm typecheck`,
  `pnpm lint` and `pnpm test`) before pushing.
- Changes that affect the published package need a changeset (below).
- By contributing you agree your work is licensed under the MIT license.

## Coding style

- [Biome](https://biomejs.dev) formats and lints: tabs, double quotes.
- TypeScript is strict and compiles with `erasableSyntaxOnly`: no enums or
  parameter properties.
- Keep scenes a pure function of signals (no `Math.random` in geometry).
  Prefer clarity over micro-optimization.

### Naming

Public names follow the user-facing
[naming conventions](https://sophistry.dev/start/concepts/#naming-conventions).
In short:

1. Spell names out (`radius`, `center`, `function`, `columns`); single letters
   only for coordinates (`x y z`, `u v w`), `t`, `dx` and `id`.
2. Position by `center: Point`, never `cx`/`cy`.
3. Geometry takes `stroke`/`fill`; text and single-hue marks take `color`;
   categorical lists are `colors`; continuous maps are `ramp`.
4. A part toggles by its bare name (`grid`, `tip`, `labels`), `boolean | Options`;
   no `include*`/`show*`/`has*`. `visible` hides the whole component.
5. `label` is the text; `labels` draws them. Part settings are prefixed by the
   part (`numberFontSize`, `labelGap`).
6. Spacing: `gap` between things, `padding` inside a surround, `margin` from a
   frame edge, `spacing` centre-to-centre, `lineHeight` a font-size multiple.
7. min/max first: `maxRadius`, `minRadius`.
8. `samples` along one parameter, `resolution` per axis of a surface, `binCount`
   for bins.
9. `tip` is an arrowhead; the hover box is `tooltip`.
10. `orientation: "vertical" | "horizontal"`.
11. Paint order is `zIndex`; `z` is only a coordinate.
12. `createX` makes a reactive primitive, `useX` reads context (`requireX`
    throws), a bare noun is a plain value, `resolveX` turns a spec into a value.
    No `makeX`/`buildX`. Time is in seconds.

While the package is unreleased, renames are hard renames: no aliases.

### JSDoc

The API reference is generated from JSDoc, so write it for users:

- **Props**: one sentence in the user's terms, plus a `@default` tag. Units only
  when they are not scene units. At most one more line for a non-obvious
  interaction.
- **Components and functions**: one to three sentences on what it is and when
  to use it, and `@see` to the guide section. Behavioural detail belongs in the
  guide, once.
- **`@example`** only on main entry points (`Stage`, `Chart`, `BarChart`,
  `MathTex`, `play`, `timeline`, `draggable`, ...) or where it teaches
  something no guide covers. Every example must typecheck (`just examples`).
- **Shared semantics** are documented once (for example on a shared props
  interface) and not restated per component.
- No rationale, history, comparisons with other libraries or internal function
  names in public docs. Module headers stay under ten lines; contributor notes
  go in a `//` comment or here.

## Tests

New behaviour needs a test; a bug fix needs a regression test. Tests live next
to the source as `*.test.ts(x)` (Vitest + happy-dom).

```sh
pnpm --filter @sophistry/core test                  # one package
pnpm --filter @sophistry/docs test                  # the docs only
pnpm --filter @sophistry/charts exec vitest run src/bars
pnpm --filter @sophistry/core exec vitest run -t "keyed transitions"
```

Run a single file or package while you work and the whole suite once before
you push. Each suite uses at most half your cores locally.

- **No wall-clock time.** Drive animations with `createClock()` and `advance`.

## Changesets

If your change affects users of a published package, run `pnpm changeset` (or
`just change`), pick the bump and describe the change in user-facing terms,
with a migration snippet for a breaking change. While we are `0.x`, a breaking
change is a **minor** and a fix or compatible addition a **patch**. Docs-only
and internal changes need no changeset. On merge to `main` the release
workflow opens a "Version Packages" PR; merging it publishes to npm with
provenance.

## Docs and examples

- The docs site is Astro + Starlight in `docs/`. The API reference under
  `docs/src/content/docs/api/` is generated from JSDoc and gitignored.
- Gallery examples are typechecked modules in
  `docs/src/examples/<category>/<Name>.tsx`; `pnpm typecheck` compiles them and
  `pnpm test` mounts every one. See
  [docs/src/examples/README.md](docs/src/examples/README.md).
- The big categories (plotting, animation, interaction) are split into
  sub-pages. A new example in one of them needs an entry in `SUBGALLERIES` in
  `docs/src/lib/examples.ts`; the build and a test fail if one is missing or
  listed twice. Its name, and so its visual baseline, stays `<category>/<Name>`.
- `ROADMAP.md` is mirrored into the docs by `docs/scripts/sync-roadmap.mjs`
  (run on build; `pnpm --filter @sophistry/docs check:roadmap` verifies it).
- Run `just build-docs` when you change docs structure or add API.

## Browser tests and visual regression

`just e2e` builds the docs and runs the Playwright suite in `e2e/`. The
`gallery` project mounts every example, checks that it paints without errors,
and compares its canvas with a baseline in
`e2e/__screenshots__/gallery/<category>/<Name>.png` (more than 10 noticeably
different pixels fails).

- **Captures are deterministic.** Pages open with `?capture`, which holds each
  example's clock and steps it in fixed 1/60 s steps until it rests. Examples
  with their own clock are captured under reduced motion. An example that
  never stops must be listed in `LOOPS` in `e2e/tests/gallery.spec.ts`; the
  test tells you when one is missing. Capture mode is compiled in only on the
  dev server and in builds with `PUBLIC_SOPHISTRY_CAPTURE=1`.
- **Baselines are Linux-only**, rendered in the official Playwright container
  (linux/amd64), which CI also uses. Locally, plain `pnpm test:e2e` skips the
  comparison; with Docker:

  ```sh
  pnpm test:e2e:visual            # just e2e-visual: compare in the container
  pnpm test:e2e:visual --native   # arm64 image on Apple silicon: faster, nearly identical
  pnpm test:e2e:update            # just e2e-update: rewrite every baseline (amd64 only)
  just e2e-update -g UnitCircle   # extra arguments go to Playwright
  ```

- **Update baselines in the same PR** as any change meant to alter the gallery,
  and check every changed PNG. Never update them to silence an unexplained
  failure: read `e2e/test-results/` (`*-expected`, `*-actual`, `*-diff`), or
  CI's `playwright-report` artifact, first.
- **Bumping Playwright**: pin the version exactly in `package.json`, update the
  image tag in `.github/workflows/ci.yml`, then regenerate the baselines.
  `pnpm check:playwright` fails when they disagree.

## Conduct and security

See the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities as
described in [SECURITY.md](SECURITY.md), not in public issues.
