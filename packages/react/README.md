# @sophistry/react

React bindings for sophistry: `<Stage>`, one component per core definition, and hooks.

Part of [sophistry](https://sophistry.dev), controllable Manim for the web. Pre-1.0: minor releases may break.

## Install

```sh
pnpm add @sophistry/core @sophistry/react react
```

## Example

```tsx
import { draw, track } from "@sophistry/core";
import { Circle, Stage, usePlayer } from "@sophistry/react";
import { useEffect, useState } from "react";

function Drawing() {
  const player = usePlayer();
  const [drawn] = useState(() => track(0));
  useEffect(() => {
    void player.play(draw(drawn, { duration: 1.5 }));
  }, [player, drawn]);
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

[Documentation](https://sophistry.dev) · [API reference](https://sophistry.dev/api/modules/) · [Source](https://github.com/BenjaminLucier/sophistry/tree/main/packages/react) · MIT
