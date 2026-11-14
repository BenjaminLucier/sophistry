# @sophistry/solidjs

## 0.2.0

### Minor Changes

- [#5](https://github.com/BenjaminLucier/sophistry/pull/5) [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - New package `@sophistry/box`: `box` (`<Box>` from `@sophistry/solidjs/box` and `@sophistry/react/box`) lays out text, other boxes and any scene node with flexbox or grid (`display: "grid"`, typed track templates and placements), and paints a background and a border with a width per side and rounded corners. Styles are typed inline objects in design pixels; text properties are handed down to the text inside. In the core, a container can give each child a space of its own (`childSpaceFor`), and text inherits a style from `textStyleContext` and takes `underline` and `strikethrough`.
  
  `layoutTo` animates boxes to a new style or new children: every box, text and scene node in the tree moves from its old place to its new one, matched by identity, and the change scrubs and rewinds like any animation. A box lays out again when a scene node inside it changes size; in the core, containers can watch their descendants' geometry (`watchesChildGeometry`, `childGeometryChanged`).

- [#5](https://github.com/BenjaminLucier/sophistry/pull/5) [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - Lengths in design pixels. A scene is 1920 design pixels wide (`designWidth`), fixed against `units` when it is made, so a scene unit is 120 px at the defaults. `group` and `text` take `lengthUnit: "px" | "scene"`: a px group's children, strokes and text are sized in pixels while the group's own position stays in its parent's units. Theme defaults (stroke width, font size) keep their scene size inside a px group. `pixelsPerUnitContext` gives the ratio.

- [#5](https://github.com/BenjaminLucier/sophistry/pull/5) [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - One text node for every kind of text. `label` is now `text` (`<Text>`), and it takes strings or spans with their own font, colour, opacity, underline, strikethrough and highlight, breaks at newlines, and wraps at a `width`, with lines broken by Pretext. `textAlign` sets how lines sit in a block. `paragraph` and `wrapText` are gone: use `text` with a `width`, and `layoutText` to lay text out yourself. `bulletedList` items take spans.
  
  Any scene node can sit inside a line of text: `{ inline: node }` among the runs is laid out like one wide glyph, lines break around it, and its line grows to hold it. `mathTex` sits on its own baseline (`textBaseline()`); other nodes are centred on the text or take a `baseline`. `layoutText` takes inline runs (`LayoutInline`), and nodes measure their box in their own units with `ownBounds()`.

- [#5](https://github.com/BenjaminLucier/sophistry/pull/5) [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - Rounded corners are true curves, and `rect` and `square` take `cornerRadii` for a radius per corner (each optionally elliptical, `{ x, y }`); radii too large for the box shrink together, as in CSS. `roundedRectCurvePath` and `resolveCornerRadii` in `@sophistry/core/geometry` build the same outlines. New `image` definition (`<Image>` in the bindings) lays a picture into a box with `objectFit` (`"contain"`, `"cover"`, `"fill"`), and `loadImage` decodes a URL or `Blob` into its pixels.

### Patch Changes

- Updated dependencies [[`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3)]:
  - @sophistry/box@0.2.0
  - @sophistry/core@0.2.0
  - @sophistry/text@0.2.0
  - @sophistry/3d@0.2.0
  - @sophistry/charts@0.2.0

## 0.1.0

### Patch Changes

- [#1](https://github.com/BenjaminLucier/sophistry/pull/1) [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - Types now resolve under every TypeScript module resolution, not only `bundler`. With `"moduleResolution": "node16"` or `"nodenext"` (what `tsc --init` sets up), every entry point's types previously failed to load: the packages are now compiled with `nodenext` themselves, so their declarations use explicit import paths.
  
  - `@sophistry/core` lists `@types/d3-ease` as a dependency: the types of `easings` come from it, and without it `strict` projects reported errors in, or silently lost the types of, the easing curves.
  - `@sophistry/react` imports `react-reconciler/constants.js` by its full path, as Node's ESM resolution requires for a package without an `exports` map.
  - `@sophistry/3d` no longer depends on `wgpu-matrix`, which it never imported.
  - The packages no longer ship declaration maps, which pointed at source files that are not published.
- Updated dependencies [[`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d), [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d), [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d), [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d)]:
  - @sophistry/core@0.1.0
  - @sophistry/text@0.1.0
  - @sophistry/charts@0.1.0
  - @sophistry/3d@0.1.0
