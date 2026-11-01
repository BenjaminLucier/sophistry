# Gallery examples

Every file here is a live, typechecked example shown on the docs site under
`/gallery/<category>/` (or one of its sub-pages): the running canvas, the file's source (with a copy
button).

## File format

`docs/src/examples/<category>/<Name>.tsx`, where `<category>` is one of
`basic`, `animation`, `plotting`, `interaction`, `maths`, `three-d`, `advanced`
and `<Name>` is PascalCase (it becomes the `#Name` anchor). These are Solid
components on `@sophistry/solidjs`.

```tsx
import { Circle, Stage } from "@sophistry/solidjs";

export const meta = {
	title: "Short title",
	description: "One sentence on what it shows.",
};

export default function Name() {
	return (
		<Stage units={8}>
			<Circle center={{ x: 0, y: 0 }} radius={2} />
		</Stage>
	);
}
```

Framework-free examples live in `docs/src/examples/vanilla/<Name>.ts`: plain
TypeScript on `@sophistry/core` whose default export builds the scene in a
host element and returns its cleanup.

```ts
import type { Clock } from "@sophistry/core";
import { circle, createScene } from "@sophistry/core";

export const meta = { title: "...", description: "..." };

export default function mount(host: HTMLElement, clock?: Clock): () => void {
	const scene = createScene({ host, clock, units: 8 });
	scene.add(circle.create({ radius: 2 }));
	return () => scene.dispose();
}
```

The island passes the example's own clock (see below); pass it to
`createScene` and run animations with `scene.play(...)`.

React examples are shown as code blocks in the guides only: the site does not
mount React (it has no React integration), so they are not live here. The
React bindings' own tests cover them.

The file is a complete module a reader can copy. The `export const meta = {...};`
block (must end with `};` at column 0) is the only thing stripped from the
displayed source.

## Conventions

- One idea per example, roughly 40 lines or fewer, no boilerplate a reader does
  not need.
- Import from `@sophistry/solidjs` (and its `/text`, `/charts`,
  `/charts/3d`, `/3d` subpaths) for components and hooks, from
  `@sophistry/core` (and `/geometry`, `/color`, `/themes`),
  `@sophistry/text`, `@sophistry/charts`, `@sophistry/3d` for
  everything else, and `solid-js`. Never `/internal`.
- Pass the `Readable` itself as the prop for anything that animates
  (`<Circle radius={radius} />`, `center={derive(angle, ...)}`): it binds in
  core and no Solid code runs per frame. Solid signals are for state changed by
  user input; `useTrackValue` only for DOM text and logic.
- The node is the handle: a component returns its scene node, and `ref`
  receives it (`chartHandle(node)`, `node.bounds()`).
- Run animations through `usePlayer()` (or `useScene().play`), never core's
  bare `play()`: each example runs on its own clock, which the site's
  `<Stage>` and `usePlayer` pick up from the island's `<ClockProvider>`. Start them
  in `onSettled(...)`, never in the component body. Loop gently or end in a
  good resting state; the Replay button remounts the example.

## Adding one

1. Create the file in the right category directory. The `animation`,
   `plotting` and `interaction` categories are split into sub-pages
   (`/gallery/plotting/bars-and-parts/`, ...): add the new id to one of them in
   `SUBGALLERIES` in `src/lib/examples.ts`, or the build fails. The file stays
   in its category directory, so its name and visual baseline do not depend on
   which sub-page shows it.
2. Embed it anywhere with `<Example name="basic/Name" />` (import
   `components/Example.astro` in the `.mdx`); it already appears on its
   category page, which renders `<Gallery category="..." />`, and in the
   gallery overview.
3. Check: `pnpm --filter @sophistry/docs typecheck`, `pnpm --filter
   @sophistry/docs test` (mounts every example under happy-dom), then
   `pnpm --filter @sophistry/docs build`.
4. Add its visual baseline: `just e2e-update -g <Name>` (needs Docker). If it
   animates forever, first list it in `LOOPS` in `e2e/tests/gallery.spec.ts`
   with the clock time to capture it at. See "Browser tests and visual
   regression" in [CONTRIBUTING.md](../../../CONTRIBUTING.md). Editing an
   example's look means updating its baseline the same way.
