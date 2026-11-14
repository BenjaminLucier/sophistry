# @sophistry/3d

## 0.2.0

### Patch Changes

- Updated dependencies [[`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3)]:
  - @sophistry/core@0.2.0

## 0.1.0

### Patch Changes

- [#1](https://github.com/BenjaminLucier/sophistry/pull/1) [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - Types now resolve under every TypeScript module resolution, not only `bundler`. With `"moduleResolution": "node16"` or `"nodenext"` (what `tsc --init` sets up), every entry point's types previously failed to load: the packages are now compiled with `nodenext` themselves, so their declarations use explicit import paths.
  
  - `@sophistry/core` lists `@types/d3-ease` as a dependency: the types of `easings` come from it, and without it `strict` projects reported errors in, or silently lost the types of, the easing curves.
  - `@sophistry/react` imports `react-reconciler/constants.js` by its full path, as Node's ESM resolution requires for a package without an `exports` map.
  - `@sophistry/3d` no longer depends on `wgpu-matrix`, which it never imported.
  - The packages no longer ship declaration maps, which pointed at source files that are not published.
- Updated dependencies [[`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d), [`16ca20a`](https://github.com/BenjaminLucier/sophistry/commit/16ca20a353637bee7ec350ba48a2df1ff422dd6d)]:
  - @sophistry/core@0.1.0
