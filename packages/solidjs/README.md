# @sophistry/solidjs

SolidJS bindings for sophistry: `<Stage>`, one component per core definition, and hooks (`usePlayer`, `useTrack`, `useScene`).

Part of [sophistry](https://sophistry.dev), controllable Manim for the web. Pre-1.0: minor releases may break.

## Install

```sh
pnpm add @sophistry/core @sophistry/solidjs solid-js@2.0.0-rc.14 @solidjs/web@2.0.0-rc.14
```

## Example

```tsx
import { draw, track } from "@sophistry/core";
import { Circle, Stage, usePlayer } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

function Drawing() {
  const { play } = usePlayer();
  const drawn = track(0);
  onSettled(() => {
    void play(draw(drawn, { duration: 1.5 }));
  });
  return <Circle radius={2} progress={drawn} />;
}

export const Scene = () => (
  <Stage units={8}>
    <Drawing />
  </Stage>
);
```

Subpaths `/text`, `/charts`, `/charts/3d` and `/3d` hold the components of the matching packages.

## Links

[Documentation](https://sophistry.dev) · [API](https://sophistry.dev/reference/api/) · [Source](https://github.com/BenjaminLucier/sophistry/tree/main/packages/solidjs) · MIT
