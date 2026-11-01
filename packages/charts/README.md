# @sophistry/charts

Charts for sophistry scenes: bars, lines, scatter, histograms, pies, heatmaps, hierarchies and more, with keyed transitions and reveals.

Part of [sophistry](https://sophistry.dev), controllable Manim for the web. Pre-1.0: minor releases may break.

## Install

```sh
pnpm add @sophistry/core @sophistry/charts
```

## Example

```ts
import { createScene } from "@sophistry/core";
import { chart, scatter } from "@sophistry/charts";

const scene = createScene({ host: document.getElementById("stage") as HTMLElement });
scene.root.add(
  chart.create({
    width: 12,
    height: 6,
    children: [scatter.create({ data: [{ x: 1, y: 2 }, { x: 2, y: 3 }], x: "x", y: "y" })],
  }),
);
```

Use the components in [`@sophistry/solidjs/charts`](../solidjs) or `@sophistry/react/charts` from JSX. `/math` holds the plotting helpers and `/3d` the 3D charts.

## Links

[Documentation](https://sophistry.dev) · [API](https://sophistry.dev/reference/api/) · [Source](https://github.com/BenjaminLucier/sophistry/tree/main/packages/charts) · MIT
