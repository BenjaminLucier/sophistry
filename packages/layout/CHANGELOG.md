# @sophistry/layout

## [0.3.2](https://github.com/BenjaminLucier/sophistry/compare/layout-v0.3.1...layout-v0.3.2) (2026-11-19)


### Miscellaneous Chores

* **layout:** Synchronize sophistry versions

## [0.3.1](https://github.com/BenjaminLucier/sophistry/compare/layout-v0.3.0...layout-v0.3.1) (2026-11-17)


### Miscellaneous Chores

* **layout:** Synchronize sophistry versions

## [0.3.0](https://github.com/BenjaminLucier/sophistry/compare/layout-v0.2.0...layout-v0.3.0) (2026-11-17)


### Miscellaneous Chores

* **layout:** Synchronize sophistry versions

## 0.2.0

### Minor Changes

- [#5](https://github.com/BenjaminLucier/sophistry/pull/5) [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - New package: a flexbox and grid layout engine in plain TypeScript. `computeLayout` takes a tree of CSS-like styles (flex direction, wrapping, grow and shrink, alignment, gaps, margins including `auto`, padding, borders, min and max sizes, aspect ratio, absolute positioning; grid templates with fixed, percentage, `fr`, intrinsic, `minmax`, `fit-content` and repeated tracks including `auto-fill` and `auto-fit`, line and span placement, sparse and dense auto-placement, and item and content alignment) plus measure functions for leaves, and returns every node's box. Behaviour is checked against Chrome through recorded fixtures. No DOM and no dependencies.
