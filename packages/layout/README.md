# @sophistry/layout

A flexbox and CSS grid layout engine in plain TypeScript. Describe a tree of nodes with CSS-like styles, give leaves a way to measure their content, and get every node's box back. No DOM, no dependencies.

Part of [sophistry](https://sophistry.dev), which uses it to lay out boxes on a canvas, but it knows nothing about sophistry: numbers in, numbers out. Pre-1.0: minor releases may break.

## Install

```sh
pnpm add @sophistry/layout
```

## Example

```ts
import { computeLayout } from "@sophistry/layout";

const layout = computeLayout(
	{
		style: { width: 400, padding: { top: 16, right: 16, bottom: 16, left: 16 }, columnGap: 8 },
		children: [
			{ style: { flexGrow: 1, height: 40 } },
			{ style: { width: 120, height: 40 } },
		],
	},
	{ width: 1000, height: 1000 },
);
// layout.children[0] → { x: 16, y: 16, width: 240, height: 40, ... }
```

## Styles

Values follow CSS. A number is a length (the unit is yours), `"50%"` is a percentage of the containing block, and `"auto"` lets the algorithm decide. Every size is a border-box size. Defaults are CSS's, except that `display` defaults to `"flex"`.

- `display`: `"flex"`, `"grid"` or `"none"`
- `position`: `"relative"` or `"absolute"`, with `top`, `right`, `bottom`, `left`
- `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `aspectRatio`
- `margin` (lengths or `"auto"`), `padding`, `border`: objects with `top`, `right`, `bottom`, `left`
- `overflow`: `"visible"` or `"hidden"` (a hidden item may shrink below its content)
- `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `alignSelf`, `alignContent`, `rowGap`, `columnGap`, `flexGrow`, `flexShrink`, `flexBasis`
- Grid containers: `gridTemplateColumns`, `gridTemplateRows` (lengths, percentages, `{ fr }`, `"auto"`, `"min-content"`, `"max-content"`, `{ minmax }`, `{ fitContent }`, and `{ repeat, tracks }` with a count, `"auto-fill"` or `"auto-fit"`), `gridAutoColumns`, `gridAutoRows`, `gridAutoFlow` (`"row"`, `"column"`, each optionally `dense`), `justifyItems`, plus `justifyContent`, `alignContent`, `alignItems` and the gaps
- Grid items: `gridColumn`, `gridRow` (a line number, negative from the end, or `{ start, end, span }`), `justifySelf`, `alignSelf`, and margins, auto margins included

```ts
{
	style: {
		display: "grid",
		gridTemplateColumns: [120, { repeat: "auto-fill", tracks: [{ minmax: [80, { fr: 1 }] }] }],
		columnGap: 8,
	},
	children: [{ style: { gridColumn: { span: 2 } } }, {}],
}
```

In a grid container `alignItems` and `alignSelf` place an item vertically within its area (`"flex-start"` is the start of the area), and `justifyItems` and `justifySelf` place it horizontally. Absolute children of a grid container are placed against its padding box. Grid lines have no names.

## Measuring leaves

A leaf with content (text, an image) takes a `measure` function. It receives the content-box dimensions already decided (`known`) and the space available, which is a number or the intrinsic size wanted (`"min-content"`, `"max-content"`), and returns the content-box size. Text wraps at `known.width` when given, otherwise at a numeric `available.width`, and returns its longest word's width under `"min-content"`.

## The root

The root is sized like an absolutely positioned element: its own `width` and `height` when set, otherwise as wide as its content up to the available width, and as tall as its content.

## Matching the browser

Every behaviour is checked against Chrome. Each fixture in `test/fixtures` is a small layout; `pnpm fixtures` renders them all in Chromium through Playwright and records every box, and the tests compare the engine's output with those boxes. The tests themselves need no browser.

## License

MIT
