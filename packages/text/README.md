# @sophistry/text

LaTeX and font outlines as sophistry geometry: KaTeX layout, opentype glyphs, and morphs between formulas.

Part of [sophistry](https://sophistry.dev), controllable Manim for the web. Pre-1.0: minor releases may break.

## Install

```sh
pnpm add @sophistry/core @sophistry/text
```

## Example

```ts
import { createScene } from "@sophistry/core";
import { mathTex } from "@sophistry/text";

const scene = createScene({ host: document.getElementById("stage") as HTMLElement });
const formula = mathTex.create({ tex: "e^{i\\pi} + 1 = 0", fontSize: 1.2 });
scene.root.add(formula);
await formula.ready();
```

From JSX use `<MathTex>` in [`@sophistry/solidjs/text`](../solidjs). The KaTeX fonts ship as separate assets and load only when a formula needs them.

## Links

[Documentation](https://sophistry.dev) · [API](https://sophistry.dev/reference/api/) · [Source](https://github.com/BenjaminLucier/sophistry/tree/main/packages/text) · MIT
