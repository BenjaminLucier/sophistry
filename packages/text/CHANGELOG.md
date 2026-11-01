# @sophistry/text

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
