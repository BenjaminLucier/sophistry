# @sophistry/box

Boxes for sophistry scenes: flexbox layout, backgrounds, rounded borders and wrapped rich text, drawn on the canvas with everything else.

Part of [sophistry](https://sophistry.dev), controllable Manim for the web. Pre-1.0: minor releases may break.

## Install

```sh
pnpm add @sophistry/core @sophistry/box
```

## Example

```ts
import { box } from "@sophistry/box";
import { circle, createScene, text } from "@sophistry/core";

const scene = createScene({ host: document.getElementById("stage") as HTMLElement });
scene.add(
	box.create({
		style: { flexDirection: "column", gap: 24, padding: 48, background: "#1e2a3a", borderRadius: 32, color: "#ffffff" },
		children: [
			text.create({ text: "Fourier series", fontSize: 72 }),
			text.create({ text: "Any periodic function is a sum of sines.", width: 600 }),
			circle.create({ radius: 1 }),
		],
	}),
);
```

Inside a box, numbers are design pixels (a scene is 1920 wide, so 120 px to a scene unit at the default 16 units) and y runs down. The outermost box is centred on its `x`/`y`. Text takes the box's text style and wraps to its width; scene nodes keep their own units, scaled into their cell. Layout comes from [`@sophistry/layout`](../layout), which matches Chrome's flexbox.

From JSX use `<Box>` in [`@sophistry/solidjs/box`](../solidjs) or [`@sophistry/react/box`](../react).

## Links

[Documentation](https://sophistry.dev) · [API](https://sophistry.dev/reference/api/) · [Source](https://github.com/BenjaminLucier/sophistry/tree/main/packages/box) · MIT
