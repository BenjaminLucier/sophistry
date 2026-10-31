# @sophistry/3d

3D for sophistry: cameras, primitives, surfaces, polyhedra and orbit controls, depth-sorted and projected onto the 2D canvas.

Part of [sophistry](https://sophistry.dev), controllable Manim for the web. Pre-1.0: minor releases may break.

## Install

```sh
pnpm add @sophistry/core @sophistry/3d
```

## Example

```ts
import { createScene } from "@sophistry/core";
import { camera3D, cube3D } from "@sophistry/3d";

const scene = createScene({ host: document.getElementById("stage") as HTMLElement });
scene.root.add(camera3D.create({}), cube3D.create({}));
```

From JSX use the components in [`@sophistry/solidjs/3d`](../solidjs) or `@sophistry/react/3d`.

## Links

[Documentation](https://sophistry.dev) · [API reference](https://sophistry.dev/api/modules/) · [Source](https://github.com/BenjaminLucier/sophistry/tree/main/packages/3d) · MIT
