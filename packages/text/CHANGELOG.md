# @sophistry/text

## 0.2.0

### Minor Changes

- [#5](https://github.com/BenjaminLucier/sophistry/pull/5) [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - One text node for every kind of text. `label` is now `text` (`<Text>`), and it takes strings or spans with their own font, colour, opacity, underline, strikethrough and highlight, breaks at newlines, and wraps at a `width`, with lines broken by Pretext. `textAlign` sets how lines sit in a block. `paragraph` and `wrapText` are gone: use `text` with a `width`, and `layoutText` to lay text out yourself. `bulletedList` items take spans.
  
  Any scene node can sit inside a line of text: `{ inline: node }` among the runs is laid out like one wide glyph, lines break around it, and its line grows to hold it. `mathTex` sits on its own baseline (`textBaseline()`); other nodes are centred on the text or take a `baseline`. `layoutText` takes inline runs (`LayoutInline`), and nodes measure their box in their own units with `ownBounds()`.

### Patch Changes

- Updated dependencies [[`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3)]:
  - @sophistry/core@0.2.0

## 0.1.0

### Minor Changes

- [#1](https://github.com/BenjaminLucier/sophistry/pull/1) [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - `@sophistry/text` no longer imports KaTeX's stylesheet itself, and `katex` is now a peer dependency. Importing the stylesheet from inside the package broke `import "@sophistry/text"` under plain Node (SSR, tests, scripts) and its types under TypeScript 6+. Install KaTeX alongside it and import the stylesheet once in your app:
  
  ```sh
  pnpm add katex
  ```
  
  ```ts
  // before: nothing (the package imported it)
  // after, next to your app's entry point:
  import "katex/dist/katex.css";
  ```
  
  Without the stylesheet formulas are positioned wrong, so the first formula logs a warning when it is missing.

### Patch Changes

- [#1](https://github.com/BenjaminLucier/sophistry/pull/1) [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - Types now resolve under every TypeScript module resolution, not only `bundler`. With `"moduleResolution": "node16"` or `"nodenext"` (what `tsc --init` sets up), every entry point's types previously failed to load: the packages are now compiled with `nodenext` themselves, so their declarations use explicit import paths.
  
  - `@sophistry/core` lists `@types/d3-ease` as a dependency: the types of `easings` come from it, and without it `strict` projects reported errors in, or silently lost the types of, the easing curves.
  - `@sophistry/react` imports `react-reconciler/constants.js` by its full path, as Node's ESM resolution requires for a package without an `exports` map.
  - `@sophistry/3d` no longer depends on `wgpu-matrix`, which it never imported.
  - The packages no longer ship declaration maps, which pointed at source files that are not published.

- [#1](https://github.com/BenjaminLucier/sophistry/pull/1) [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - `loadFace` now resolves to the exported `OpenTypeFont` type. Its type previously came from a declaration that was not published, so it did not resolve in your project.
- Updated dependencies [[`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d), [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d)]:
  - @sophistry/core@0.1.0
