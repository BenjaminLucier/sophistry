# @sophistry/box

## 0.2.0

### Minor Changes

- [#5](https://github.com/BenjaminLucier/sophistry/pull/5) [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3) Thanks [@BenjaminLucier](https://github.com/BenjaminLucier)! - New package `@sophistry/box`: `box` (`<Box>` from `@sophistry/solidjs/box` and `@sophistry/react/box`) lays out text, other boxes and any scene node with flexbox or grid (`display: "grid"`, typed track templates and placements), and paints a background and a border with a width per side and rounded corners. Styles are typed inline objects in design pixels; text properties are handed down to the text inside. In the core, a container can give each child a space of its own (`childSpaceFor`), and text inherits a style from `textStyleContext` and takes `underline` and `strikethrough`.
  
  `layoutTo` animates boxes to a new style or new children: every box, text and scene node in the tree moves from its old place to its new one, matched by identity, and the change scrubs and rewinds like any animation. A box lays out again when a scene node inside it changes size; in the core, containers can watch their descendants' geometry (`watchesChildGeometry`, `childGeometryChanged`).

### Patch Changes

- Updated dependencies [[`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3), [`2ee6b3b`](https://github.com/BenjaminLucier/sophistry/commit/2ee6b3bd87cc9ec2dbe0e51961db3611a10567f3)]:
  - @sophistry/core@0.2.0
  - @sophistry/layout@0.2.0
