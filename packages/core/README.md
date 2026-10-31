# @sophistry/core

Framework-free animation and visualization engine: a retained scene graph, tracks, seekable animations, geometry, themes and a Canvas2D renderer. Pair it with a binding ([`@sophistry/solidjs`](../solidjs) or [`@sophistry/react`](../react)).

Part of [sophistry](https://sophistry.dev), controllable Manim for the web. Pre-1.0: minor releases may break.

## Install

```sh
pnpm add @sophistry/core
```

## Example

```ts
import { circle, createScene, draw, track } from "@sophistry/core";

const scene = createScene({ host: document.getElementById("stage") as HTMLElement });
const drawn = track(0);
scene.root.add(circle.create({ radius: 2, progress: drawn }));
void scene.play(draw(drawn, { duration: 1.5 }));
```

Subpaths: `/geometry`, `/color`, `/themes` (pure helpers) and the unstable `/internal`.

## Links

[Documentation](https://sophistry.dev) · [API reference](https://sophistry.dev/api/modules/) · [Source](https://github.com/BenjaminLucier/sophistry/tree/main/packages/core) · MIT
